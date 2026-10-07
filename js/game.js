(() => {
// ---------------------------------------------------------------------------
// RIDE THE MONSOON — module map
//   game state .............. initialState(), snapshotVoyage()
//   projection / camera ..... VIEW, updateViewProjection, projectWorld,
//                            screenToWorld, setPlanFrame, isVisible
//   input ................... key handler, pointer steering, zoom wheel
//   physics ................. sailing step: speed, heel, wake, collisions
//   wind ..................... updateWind(), windEffect(), monsoon reversal
//   environment ............. storms, fog, squalls, earthquakes, tsunami,
//                            typhoon, provisioning, navigation problems
//   pirate AI ............... spawnPirate, pirate chase AI, damage
//   disasters ............... showEncounterDecision, resolveEncounter,
//                            resolveDisasterField
//   trading ................. settleCalicutCargo, updateMarket, buy/sell
//   story branching ......... advanceChain / continueChain, decisions by id
//   historical reasoning .... showDecision reasoning callouts, lessons,
//                            journal, continuity + final report
//   rendering ............... ocean, weather, ships, islands, ports, labels
//   UI ...................... updateHud, panels, teacher mode, dev console
// ---------------------------------------------------------------------------
const {
  decisions, goods, levels, technologies, networks, perspectives,
  journalCategories, sources, repairCrisis, groundingCrisis,
  PRE_VOYAGE_CHAIN, CALICUT_CHAIN,
} = window.gameData;
const $ = (id) => document.getElementById(id);
const canvas = $('oceanCanvas');
const ctx = canvas.getContext('2d');
const BASE_SPEED = 265;
const PIRATE_MAX_SPEED = 450;
const PIRATE_CHASE_DURATION = 90;
const PIRATE_MAX_HEALTH = 500;
const PIRATE_OBSTACLE_DAMAGE_SCALE = 5;
const BASE_ROUTE_DISTANCE = 108000;
const PORT_LAND_RADIUS = 165;
const PORT_ARRIVAL_RADIUS = 178;
const SHIP_START_OFFSET = 178;
const COURSE_CENTER = 2600;
const DEG = Math.PI / 180;
// Provisions are the scarcest resource on a monsoon crossing, so the hold can carry
// a deep reserve. The repair costs stay fixed (-15 / -5) and the budget must fund them.
const SUPPLY_CAP = 160;

// High-angle top-down view rig. The camera is a real pinhole camera hovering over
// the water plane: `pitch` is how far below horizontal it looks, `fovY` is the
// vertical cone, and `anchorY` is the screen fraction the optical axis lands on.
// Because `pitch` always exceeds the top cone angle, the frustum can never see
// above the horizon, so the sky is structurally gone rather than cropped away.
const VIEW = {
  baseHeight: 1500,        // altitude in world units at zoom 1
  pitch: 60 * DEG,
  fovY: 52 * DEG,
  anchorY: .575,           // ship sits a little below centre
  minZoom: .72,
  maxZoom: 1.7,
  maxWorldWidth: 3200,     // keeps the ship from shrinking away on ultrawide
  followRate: 3.6,
  yawRate: 2.4,
  shipScreenY: .66,         // where the ship rests vertically, as a screen fraction
  chaseZoom: .9,            // pull back further during a pirate chase
  cullMargin: 260,
};

const initialState = () => ({
  started: false, paused: false, pausedByDecision: false, desiredHeading: null, muted: false, phase: 'prepare', decisionIndex: 0, level: 5, eventIndex: 0,
  hull: 100, supplies: 150, money: 72, trust: 50, cargo: [], cargoDamage: 0, cargoRisk: 0, goodsSold: 0,
  windBonus: 0, navigation: 0, returnWind: 0, protected: false, culture: false, stormSafe: false,
  routeDistance: 1, routeSpeed: 1, routeHazard: 1, routeCurve: 0, routeSafety: 1, obstacleSpacing: 1, eventPower: 1,
  returnSpeed: 1, returnHazard: 1, returnObstacleSpacing: 1,
  merchant: '', priceMod: 0, log: [], skills: new Set(), marketPhase: 'sell', marketProfit: 0, cargoReturned: 0, goodDecisions: 0, poorDecisions: 0,
  effects: { control: 1, speed: 1, stability: 1, waves: 1, wind: 1, fog: 0, time: 0 }, pendingEvent: null,
  waveSurge: 0, waveTimeLeft: 0, extraFog: 0, fogTimeLeft: 0, gustPower: 0, gustTimeLeft: 0,
  pirate: null, pirateCooldown: 0, pirateEncounters: 0, pirateEscapes: 0, pirateDecisionDeadline: 0,
  ship: { x: SHIP_START_OFFSET, y: 0, heading: 0, sail: .62, speed: 0, vx: 0, vy: 0, turn: 0, heel: 0, bob: 0, rock: 0, wake: 0 },
  wind: { angle: 0, strength: .78, name: 'Northeast monsoon', detail: 'Wind travels east' },
  stormTriggered: false, stormSeverity: 'standard', stormActive: false, stormIntensity: 0, stormTimeLeft: 0,
  earthquake: 0, quakePower: 0, tsunami: 0, tsunamiPower: 0, typhoon: 0, typhoonPower: 0, hazardGrace: 0,
  crashCount: 0, visitedCalicut: false, returnStarted: false, finished: false, brace: 0, elapsed: 0, legElapsed: 0, hitCooldown: 0, cameraShake: 0, lightningFlash: 0, lightningX: .72,
  outboundDistance: BASE_ROUTE_DISTANCE, routeReferenceDistance: BASE_ROUTE_DISTANCE, calicutX: BASE_ROUTE_DISTANCE, legStartX: SHIP_START_OFFSET, legDistanceTotal: BASE_ROUTE_DISTANCE, legDistanceTravelled: 0, totalDistanceSailed: 0, totalTimeSailed: 0, totalJourneyTime: 0,
  chain: 'pre', chainStep: 0, pendingDecision: null, decisionCount: 0, pendingCrisis: null, crisisCount: 0, crisisCooldown: 0, crewIllness: false, repairedHull: false, patchedHull: false, devHistory: [], autoHelm: false,
  journal: {}, lessonsSeen: [], causeEffects: [], voyageStart: null,
});

let state = initialState();
let keys = {};
let lastTime = 0;
let toastTimer;
let obstacles = [];
let obstacleSerial = 0;
let nextObstacleDistance = 680;
let courseDirection = 1;
let courseAnchorX = 0;
let camera = { x: 0, y: 0, yaw: 0, zoom: 1, zoomTarget: 1, height: VIEW.baseHeight };
let particles = [];

// Per-frame projection state, rebuilt once per draw by updateViewProjection().
const view = {
  width: 1, height: 1, focal: 1, altitude: 1, pitch: 0, sinT: 0, cosT: 1,
  yaw: 0, cosYaw: 1, sinYaw: 0, anchorX: 0, anchorY: 0, halfCross: 1,
  fwdMin: 1, fwdMax: 2, shakeX: 0, shakeY: 0,
};
const projection = { x: 0, y: 0, scale: 0, depth: 0, ok: false };
const framePoint = { x: 0, y: 0, scale: 0, depth: 0, ok: false };
const pathPoint = { x: 0, y: 0, scale: 0, depth: 0, ok: false };
const shipPoint = { x: 0, y: 0, scale: 0, depth: 0, ok: false };
const rigPoint = { x: 0, y: 0, scale: 0, depth: 0, ok: false };
const worldPoint = { x: 0, y: 0 };

function cap(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cargoCount() { return state.cargo.length; }
function cargoValue() { return state.cargo.reduce((sum, id) => sum + (goods.find((good) => good.id === id)?.sell || 0), 0); }
function cargoWeight() { return state.cargo.reduce((sum, id) => sum + (goods.find((good) => good.id === id)?.weight || 0), 0); }
function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
function timeSeconds() { return state.elapsed; }
function currentLevel() { return levels[0]; }
function calculateOutboundDistance() { return Math.max(20000, BASE_ROUTE_DISTANCE * currentLevel().distance * state.routeDistance); }
function syncOutboundDistance() {
  state.outboundDistance = calculateOutboundDistance();
  if (!state.started || state.phase === 'prepare') state.routeReferenceDistance = state.outboundDistance;
  if (!state.returnStarted && state.phase !== 'market') {
    state.legDistanceTotal = Math.max(1, state.outboundDistance - SHIP_START_OFFSET - PORT_ARRIVAL_RADIUS);
    state.legDistanceTravelled = Math.min(state.legDistanceTravelled, state.legDistanceTotal);
  }
}
function activeHazardScale() { return state.returnStarted ? state.returnHazard : state.routeHazard; }
function activeObstacleSpacing() { return state.returnStarted ? state.returnObstacleSpacing : state.obstacleSpacing; }
function activeSpeedScale() { return state.returnStarted ? state.returnSpeed : state.routeSpeed; }
function routePathY(x) {
  const referenceDistance = Math.max(1, state.routeReferenceDistance || state.outboundDistance);
  const progress = cap(x / referenceDistance, 0, 1);
  const envelope = Math.sin(progress * Math.PI);
  return Math.sin(x / 1400) * 180 + state.routeCurve * envelope;
}
function legRouteProgress() {
  const total = Math.max(1, state.legDistanceTotal);
  const directionalProgress = state.returnStarted ? state.legStartX - state.ship.x : state.ship.x - state.legStartX;
  return cap(directionalProgress / total, 0, 1);
}
function remainingDistance() { return Math.max(0, state.legDistanceTotal * (1 - legRouteProgress())); }
function etaSeconds() { return state.ship.speed > 1 ? remainingDistance() / state.ship.speed : Infinity; }
function routeProgress() { return legRouteProgress(); }
function destinationPort() { return state.returnStarted ? { x: 0, y: 0, name: 'KILWA KISIWANI', subtitle: 'East African coast', side: -1 } : { x: state.outboundDistance, y: 0, name: 'CALICUT', subtitle: 'Malabar Coast', side: 1 }; }
function activeHazard() {
  if (state.pirate && state.pirate.phase !== 'retreating') return { label: 'PIRATES', color: '#ff9d8f', power: state.pirate.power };
  if (state.typhoon > 0) return { label: 'TYPHOON', color: '#ff9d8f', power: state.typhoonPower };
  if (state.tsunami > 0) return { label: 'TSUNAMI', color: '#8fd9ff', power: state.tsunamiPower };
  if (state.earthquake > 0) return { label: 'EARTHQUAKE', color: '#ffd37a', power: state.quakePower };
  if (state.stormActive) return { label: 'STORM', color: '#d7c6ff', power: state.stormIntensity };
  if (state.waveTimeLeft > 0) return { label: 'LARGE WAVES', color: '#8fd9ff', power: state.waveSurge };
  if (state.fogTimeLeft > 0) return { label: 'FOG', color: '#d5e5df', power: state.extraFog };
  if (state.gustTimeLeft > 0) return { label: 'STRONG WIND', color: '#ffcf8c', power: state.gustPower };
  return { label: 'CALM', color: '#8fe0b4', power: 0 };
}
function bearingFromCanvasAngle(angle) { return (angle * 180 / Math.PI + 90 + 360) % 360; }
function cardinal(bearing) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]; }
function angleDelta(target, current) { return Math.atan2(Math.sin(target - current), Math.cos(target - current)); }
function windRelation() { return Math.cos(state.ship.heading - state.wind.angle); }
function windEffect(relation = windRelation()) {
  if (relation >= .35) return { label: 'TAILWIND', multiplier: 1 + relation * .82, detail: 'Wind accelerates the ship' };
  if (relation <= -.35) return { label: 'HEADWIND', multiplier: Math.max(.18, 1 + relation * .82), detail: 'Wind slows the ship' };
  return { label: 'CROSSWIND', multiplier: 1, detail: 'Wind mostly pushes sideways' };
}
function sailingSkill() { return cap(.88 + state.windBonus + state.navigation + (state.returnStarted ? state.returnWind : 0), .55, 1.45); }
function physicsProfile() {
  const difficulty = currentLevel().id;
  return {
    turnRate: 1.05 + (5 - difficulty) * .16,
    turnResponse: 5.4 - (difficulty - 1) * .65,
    acceleration: 1.75 - (difficulty - 1) * .27,
    windForce: 8 + (difficulty - 1) * 17,
    waveForce: 5 + (difficulty - 1) * 12,
    currentForce: 4 + (difficulty - 1) * 10,
    maxSpeed: 330 + (difficulty - 1) * 62,
  };
}
function weatherProfile() {
  const levelSeverity = (currentLevel().id - 1) * .16;
  const storm = state.stormActive ? state.stormIntensity : 0;
  const earthquake = state.earthquake > 0 ? state.quakePower : 0;
  const tsunami = state.tsunami > 0 ? state.tsunamiPower : 0;
  const typhoon = state.typhoon > 0 ? state.typhoonPower : 0;
  const severity = cap(levelSeverity + state.wind.strength * .26 + storm * .55 + earthquake * .16 + tsunami * .3 + typhoon * .62 + state.waveSurge * .24 + state.gustPower * .18, 0, 1.9);
  return {
    severity,
    waveHeight: 3 + severity * 17 + state.waveSurge * 14,
    windSpeed: (.25 + state.wind.strength * .75 + severity * .9 + state.gustPower * .9) * state.effects.wind,
    rain: cap(storm * .75 + typhoon * 1.05 + tsunami * .3, 0, 1.5),
    fog: cap(severity * .36 + typhoon * .32 + state.extraFog + state.effects.fog, 0, 1),
    darkness: cap(severity * .54 + typhoon * .2, 0, .85),
    spray: cap(severity * .7 + state.ship.speed / 500, 0, 1.5),
  };
}

// Declared up here rather than beside the HUD helpers below: resizeCanvas() runs
// during start-up and writes hudBoxes, so a later `let` would be in its temporal
// dead zone at that point.
let hudBoxes = null;
let hudBoxAge = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hudBoxes = null;
}

// ---------------------------------------------------------------------------
// Camera + projection
// ---------------------------------------------------------------------------

// The focal length is derived from the requested vertical cone, then clamped so
// that (a) the top edge of the viewport still points below the horizon and
// (b) the bottom edge stays short of the nadir point where the plane vanishes.
function updateViewProjection() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const anchorRatio = height < 520 ? .52 : VIEW.anchorY;
  const halfAngle = VIEW.fovY / 2;
  const topShare = 2 * anchorRatio * halfAngle;
  const bottomShare = 2 * (1 - anchorRatio) * halfAngle;
  const pitch = cap(VIEW.pitch, topShare + 3 * DEG, Math.PI / 2 - bottomShare - 3 * DEG);
  const altitude = cap(camera.height, 220, 9000);

  let focal = (height / 2) / Math.tan(halfAngle);
  focal = Math.max(focal, (anchorRatio * height) / Math.tan(pitch - 4 * DEG));
  focal = Math.max(focal, ((1 - anchorRatio) * height) / Math.tan(Math.PI / 2 - pitch - 4 * DEG));
  const widthCap = (width * altitude) / (VIEW.maxWorldWidth * Math.sin(pitch));
  if (widthCap > focal) focal = widthCap;

  // Recompute the real cone from the final focal so frustum maths always matches
  // what is actually drawn, even after the clamps above.
  const u = Math.atan((height / 2) / focal);
  const topAngle = cap(pitch - 2 * anchorRatio * u, 5 * DEG, 88 * DEG);
  const bottomAngle = cap(pitch + 2 * (1 - anchorRatio) * u, 5 * DEG, 88 * DEG);

  view.width = width;
  view.height = height;
  view.focal = focal;
  view.altitude = altitude;
  view.pitch = pitch;
  view.sinT = Math.sin(pitch);
  view.cosT = Math.cos(pitch);
  view.yaw = camera.yaw;
  view.cosYaw = Math.cos(camera.yaw);
  view.sinYaw = Math.sin(camera.yaw);
  view.anchorX = width / 2;
  view.anchorY = height * anchorRatio;
  view.halfCross = (width / 2) / focal;
  view.fwdMin = altitude / Math.tan(bottomAngle);
  view.fwdMax = altitude / Math.tan(topAngle);
}

// Screen-space width of the visible water at a given distance ahead of the camera.
function crossHalfAt(forward) {
  return view.halfCross * (forward * view.cosT + view.altitude * view.sinT);
}

function projectForwardLateral(forward, lateral, out, elevation = 0) {
  const plane = view.altitude - elevation;
  const depth = forward * view.cosT + plane * view.sinT;
  if (depth < 14) { out.ok = false; return out; }
  const rise = forward * view.sinT - plane * view.cosT;
  out.x = view.anchorX + (view.focal * lateral) / depth;
  out.y = view.anchorY - (view.focal * rise) / depth;
  out.scale = view.focal / depth;
  out.depth = depth;
  out.ok = true;
  return out;
}

function projectWorld(worldX, worldY, elevation = 0, out = projection) {
  const dx = worldX - camera.x;
  const dy = worldY - camera.y;
  const forward = dx * view.cosYaw + dy * view.sinYaw;
  const lateral = -dx * view.sinYaw + dy * view.cosYaw;
  return projectForwardLateral(forward, lateral, out, elevation);
}

function isVisible(worldX, worldY, margin = 0) {
  const dx = worldX - camera.x;
  const dy = worldY - camera.y;
  const forward = dx * view.cosYaw + dy * view.sinYaw;
  if (forward < view.fwdMin - margin || forward > view.fwdMax + margin) return false;
  const depth = forward * view.cosT + view.altitude * view.sinT;
  if (depth < 14) return false;
  const lateral = -dx * view.sinYaw + dy * view.cosYaw;
  const half = crossHalfAt(forward) + margin;
  return lateral >= -half && lateral <= half;
}

// Fade entities out near the frustum edge so nothing pops in at render distance.
function distanceFade(worldX, worldY) {
  const dx = worldX - camera.x;
  const dy = worldY - camera.y;
  const forward = dx * view.cosYaw + dy * view.sinYaw;
  const farFade = cap((view.fwdMax - forward) / 260, 0, 1);
  const nearFade = cap((forward - view.fwdMin + 40) / 90, 0, 1);
  const depth = Math.max(1, forward * view.cosT + view.altitude * view.sinT);
  const lateral = Math.abs(-dx * view.sinYaw + dy * view.cosYaw);
  const sideFade = cap((crossHalfAt(forward) + 120 - lateral) / 200, 0, 1);
  return Math.min(farFade, nearFade, sideFade);
}

// Places the canvas origin on a world point and orients local +x along
// `worldAngle`, with the correct perspective foreshortening for the tilt.
function setPlanFrame(worldX, worldY, worldAngle, scaleMul = 1, elevation = 0, out = framePoint) {
  const point = projectWorld(worldX, worldY, elevation, out);
  if (!point.ok) return false;
  const delta = worldAngle - view.yaw;
  const sin = Math.sin(delta);
  const cos = Math.cos(delta);
  const scale = point.scale * scaleMul;
  ctx.transform(scale * sin, -scale * cos * view.sinT, scale * cos, scale * sin * view.sinT, point.x, point.y);
  return true;
}

function screenToWorld(screenX, screenY, out = worldPoint) {
  const slope = (view.anchorY - screenY) / view.focal;
  const denominator = view.sinT - slope * view.cosT;
  if (Math.abs(denominator) < 1e-5) return null;
  const forward = (view.altitude * (view.cosT + slope * view.sinT)) / denominator;
  if (forward < 1) return null;
  const depth = forward * view.cosT + view.altitude * view.sinT;
  const lateral = ((screenX - view.anchorX) * depth) / view.focal;
  out.x = camera.x + forward * view.cosYaw - lateral * view.sinYaw;
  out.y = camera.y + forward * view.sinYaw + lateral * view.cosYaw;
  return out;
}

// Screen angle of a world heading, compressed by the tilt so the compass rose
// matches the foreshortened chart underneath it.
function screenHeadingAngle(worldAngle) {
  const delta = worldAngle - camera.yaw;
  return Math.atan2(-Math.cos(delta) * view.sinT, Math.sin(delta));
}

function viewLookAhead() {
  return view.fwdMax - 200;
}

// Distance ahead of the lens where the water lands on a given screen row.
// Inverts the pinhole projection, so the camera can be placed by asking "where
// must the ship be on screen" instead of hand-tuning a look-ahead constant.
function forwardForScreenY(screenY, altitude) {
  const height = view.height > 8 ? view.height : Math.max(1, canvas.clientHeight);
  const anchor = height * (height < 520 ? .52 : VIEW.anchorY);
  const slope = (anchor - screenY) / view.focal;
  const denominator = view.sinT - slope * view.cosT;
  if (Math.abs(denominator) < 1e-4) return altitude;
  const forward = (altitude * (view.cosT + slope * view.sinT)) / denominator;
  return Number.isFinite(forward) && forward > 0 ? forward : altitude;
}

function updateCamera(dt) {
  const ship = state.ship;
  const weather = weatherProfile();
  const chasing = state.pirate?.phase === 'chasing';
  const targetZoom = camera.zoomTarget
    * (1 + cap(ship.speed / 11000, 0, .07))
    * (1 - weather.severity * .03)
    * (chasing ? VIEW.chaseZoom : 1);
  camera.zoom += (targetZoom - camera.zoom) * (1 - Math.exp(-dt * 2.6));
  camera.zoom = cap(camera.zoom, VIEW.minZoom, VIEW.maxZoom);
  camera.height = VIEW.baseHeight / camera.zoom;

  // Yaw eases towards the bow so the vessel always sails up-screen.
  camera.yaw += angleDelta(ship.heading, camera.yaw) * (1 - Math.exp(-dt * VIEW.yawRate));

  // Place the lens so the ship settles on its target row: lower-centre at rest,
  // easing a little further down as speed builds so more water opens up ahead.
  const height = view.height > 8 ? view.height : Math.max(1, canvas.clientHeight);
  const short = height < 520;
  const shipRow = height * (short ? .62 : VIEW.shipScreenY) + (short ? 0 : cap(ship.speed / 2600, 0, .055) * height);
  const trail = forwardForScreenY(shipRow, camera.height);
  const targetX = ship.x - Math.cos(camera.yaw) * trail;
  const targetY = ship.y - Math.sin(camera.yaw) * trail;
  const follow = 1 - Math.exp(-dt * VIEW.followRate);
  camera.x += (targetX - camera.x) * follow;
  camera.y += (targetY - camera.y) * follow;
}

function emitSound(frequency = 260, duration = .06) {
  if (state.muted || !window.AudioContext) return;
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.value = .025;
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
  oscillator.addEventListener('ended', () => audio.close());
}

function toast(message, negative = false) {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast show${negative ? ' negative' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

function setObjective(text, hint) {
  $('objectiveText').textContent = text;
  $('objectiveHint').textContent = hint;
}

// ---------------------------------------------------------------------------
// Historical lesson cards + navigator journal
// ---------------------------------------------------------------------------

const DECISION_LESSONS = {
  departure: 'The monsoon reversed on a schedule sailors planned around. Departure date shaped travel time, supply use, and which routes were possible.',
  cargo: 'Weight and value travelled together. Every good carried was a claim on space, speed, and risk.',
  navigation: 'Navigation technology did not remove danger; it changed how much danger a crew could manage.',
  comparison: 'Sea, desert, and mountain routes each solved a different problem. Comparing them shows that networks existed to match goods to the environment they could survive.',
  merchant: 'A port was a network of relationships, not a single buyer. Prices and safety both came from who you knew.',
  culture: 'Trade networks moved language, custom, religion, and knowledge alongside goods.',
  disease: 'Connected populations allowed pathogens to travel the same routes as cloth, coins, and pilgrims.',
  protection: 'Political authority shaped trade by building harbours, policing routes, and offering escorts.',
  return: 'The monsoon reversed, but hull damage and spent stores did not reset. Continuity and change both acted on the same voyage.',
};

function lessonForDecision(id) { return DECISION_LESSONS[id] || ''; }

function showLesson(text) {
  const card = $('lessonCard');
  if (!card || !text) return;
  $('lessonText').textContent = text;
  card.classList.add('show');
  state.lessonsSeen.push(text);
  clearTimeout(card.dataset.timer);
  card.dataset.timer = setTimeout(() => card.classList.remove('show'), 7600);
}

function journalAdd(category, text) {
  if (!text) return;
  if (!state.journal[category]) state.journal[category] = [];
  const list = state.journal[category];
  if (list[list.length - 1] !== text) list.push(text);
}

// Journals are the memory of cause and effect. Later hazards add a line that
// names the earlier decision which produced the current situation, so a player
// can always trace a problem back to a choice.
const CAUSE_CHAINS = {
  stormSafe: 'You handled the first storm properly, so this weather found a sound ship.',
  protected: 'The convoy agreement you paid for earlier is still shaping your exposure.',
  culture: 'Relationships you built at Calicut still support this crossing.',
  repairedHull: 'The proper repair you made after the reef strike is holding.',
  patchedHull: 'The patched hull is carrying strain from the earlier strike.',
  crewIllness: 'The fever carried west from the port is slowing the crew.',
  crewSick: 'The crew is weakened by the fever carried west from the port.',
  collisionCrisis: 'The reef strikes left a hull that hazards punish harder.',
  stormIgnored: 'You ignored earlier storm warnings, and the weather compounded.',
};

function addCauseChains() {
  const flags = [];
  if (state.stormSafe) flags.push(CAUSE_CHAINS.stormSafe);
  if (state.protected) flags.push(CAUSE_CHAINS.protected);
  if (state.culture) flags.push(CAUSE_CHAINS.culture);
  if (state.repairedHull) flags.push(CAUSE_CHAINS.repairedHull);
  if (state.patchedHull) flags.push(CAUSE_CHAINS.patchedHull);
  if (state.crewIllness) flags.push(CAUSE_CHAINS.crewSick);
  if (state.crashCount > 0) flags.push(CAUSE_CHAINS.collisionCrisis);
  if (!state.stormSafe && state.crashCount > 0) flags.push(CAUSE_CHAINS.stormIgnored);
  flags.forEach((text) => journalAdd('causation', text));
  return flags;
}

function recordDecisionInJournal(id, choice) {
  const entries = {
    departure: 'monsoon',
    cargo: 'trade',
    navigation: 'technology',
    comparison: 'causation',
    merchant: 'trade',
    culture: 'culture',
    disease: 'disease',
    protection: 'governance',
    return: 'causation',
  };
  journalAdd(entries[id] || 'causation', `${choice.label} — ${choice.note}`);
  const category = entries[id];
  if (category) journalAdd('causation', `${decisions[id]?.title || id} led to: ${choice.note}`);
}

// Short, concrete record of one cause producing one later effect, shown on the
// ending report so the player can trace their own chain.
function recordCauseEffect(cause, effect) {
  state.causeEffects.push({ cause, effect });
}

// The chart doubles as the comparison aid: whichever network the player is
// studying, the panel states its environment, its goods, and how it differs
// from the ocean route they are actually sailing.
function networkDetailHtml(hazard, pirateSeconds) {
  const active = $('networkLegend')?.querySelector('.legend-item.is-active')?.dataset.network || 'indian-ocean';
  const network = networks.find((item) => idActiveNetwork(item.id)) || networks[0];
  const chosen = networks.find((item) => item.id === active) || network;
  const seconds = Math.ceil(Math.max(pirateSeconds, state.typhoon, state.tsunami, state.earthquake, state.stormTimeLeft, state.waveTimeLeft, state.fogTimeLeft, state.gustTimeLeft));
  const live = hazard.label === 'CALM'
    ? 'Conditions on your route are calm.'
    : `Conditions on your route: <b>${hazard.label}</b>${seconds ? ` for about ${seconds}s` : ''}.`;
  return `<p><b>${chosen.name}</b> · ${chosen.kind}</p>
    <p>Environment: ${chosen.risk}.</p>
    <p>Typical goods: ${chosen.goods}.</p>
    <p>Extent: ${chosen.span}.</p>
    <p class="network-compare">Compare: ${networkComparison(chosen)}</p>
    <p class="network-live">${live}</p>`;
}

function idActiveNetwork(id) { return id === ($('networkLegend')?.querySelector('.legend-item.is-active')?.dataset.network || id); }

function networkComparison(chosen) {
  if (chosen.id === 'indian-ocean') return 'Sea travel depends on season and wind, not on the long empty distances that shaped desert caravans or the mountain stages that shaped overland trade.';
  if (chosen.id === 'silk-roads') return 'Overland trade faced mountains and tribute states rather than reefs; goods were carried in stages between many hands, not in one hull.';
  return 'Desert caravans solved water distance, the central problem the monsoon solved at sea: both networks existed to move high-value goods across difficult terrain.';
}

function wireNetworkLegend() {
  const legend = $('networkLegend');
  if (!legend) return;
  legend.querySelectorAll('.legend-item').forEach((button) => {
    button.addEventListener('click', () => {
      legend.querySelectorAll('.legend-item').forEach((other) => other.classList.toggle('is-active', other === button));
      const network = networks.find((item) => item.id === button.dataset.network);
      if (network) {
        journalAdd('trade', `Studied the ${network.name} (${network.kind}) on the route chart.`);
        journalAdd('causation', `Compared networks: ${network.name} faced ${network.risk.toLowerCase()}.`);
      }
      updateHud();
    });
  });
}

function renderJournal() {
  const host = $('journalEntries');
  if (!host) return;
  addCauseChains();
  host.innerHTML = '';
  let filled = 0;
  journalCategories.forEach((category) => {
    const entries = state.journal[category.id] || [];
    if (!entries.length) return;
    filled += 1;
    const section = document.createElement('section');
    section.className = 'journal-group';
    section.innerHTML = `<h4><span aria-hidden="true">${category.icon}</span> ${category.label}<em>${entries.length}</em></h4><ul>${entries.map((entry) => `<li>${entry}</li>`).join('')}</ul>`;
    host.appendChild(section);
  });
  if (!filled) host.innerHTML = '<p class="empty-log">Your journal fills as you make decisions.</p>';
  $('journalCount').textContent = `${filled} of ${journalCategories.length} topics recorded`;
  $('journalLearnMore').innerHTML = whatYouLearned();
}

function whatYouLearned() {
  const notes = [];
  const seen = (id) => (state.log || []).some((entry) => entry.title === decisions[id]?.title);
  notes.push(`<li><b>Cause and effect:</b> ${state.causeEffects.length} link${state.causeEffects.length === 1 ? '' : 's'} between an earlier choice and a later consequence were recorded on your voyage.</li>`);
  notes.push('<li><b>Monsoon:</b> the seasonal reversal set when ships could cross safely, which shaped your speed, stores, and both crossing dates.</li>');
  if (seen('culture')) notes.push('<li><b>Networks of exchange:</b> your port relationships changed your return route, not only your reputation.</li>');
  if (seen('navigation') || seen('comparison')) notes.push('<li><b>Technology:</b> compass, astrolabe, lateen sail, and local pilot knowledge each altered the route you could safely hold.</li>');
  if (seen('disease')) notes.push('<li><b>Disease:</b> illness travelled the same connections that carried goods, so a port decision had effects far beyond the harbour.</li>');
  if (seen('protection')) notes.push('<li><b>Governance:</b> escorts and harbour rules changed the physical safety of the route, showing political power shaping trade.</li>');
  notes.push('<li><b>Continuity:</b> the monsoon reversed and the trade continued, while your hull, stores, and crew carried every earlier decision to the end.</li>');
  return `<h3>What you learned</h3><ul>${notes.join('')}</ul>`;
}

function syncPauseIndicator() {
  const indicator = $('pauseIndicator');
  if (!indicator) return;
  const decisionVisible = !$('modalBackdrop').classList.contains('hidden');
  indicator.classList.toggle('show', state.paused && !decisionVisible);
}

function resumeVoyage() {
  if (state.pausedByDecision) return;
  state.paused = false;
  syncPauseIndicator();
  toast('Voyage resumed.');
}

function updateHud() {
  const hull = cap(state.hull, 0, 100);
  const supplies = cap(state.supplies, 0, SUPPLY_CAP);
  const trust = cap(state.trust, 0, 100);
  const relation = windRelation();
  const effect = windEffect(relation);
  const headingBearing = bearingFromCanvasAngle(state.ship.heading);
  const windBearing = bearingFromCanvasAngle(state.wind.angle);
  const positionProgress = routeProgress();
  const legProgress = legRouteProgress();
  const level = currentLevel();
  const hazard = activeHazard();
  const progress = state.finished ? 100 : state.returnStarted ? 50 + legProgress * 50 : state.visitedCalicut ? 50 : state.phase === 'sail-out' ? legProgress * 50 : state.decisionIndex * 6;

  $('levelLabel').textContent = `Level ${level.id} · The Monsoon Voyage`;
  $('hullValue').textContent = `${Math.round(hull)}%`;
  $('suppliesValue').textContent = Math.round(supplies);
  $('moneyValue').textContent = Math.max(0, Math.round(state.money));
  $('trustValue').textContent = Math.round(trust);
  $('hullBar').style.width = `${hull}%`;
  $('suppliesBar').style.width = `${cap(supplies / SUPPLY_CAP * 100, 2, 100)}%`;
  $('moneyBar').style.width = `${cap(state.money, 0, 100)}%`;
  $('trustBar').style.width = `${trust}%`;
  $('hullBar').style.background = hull < 40 ? '#c5544f' : '#0c6570';
  $('progressBar').style.width = `${cap(progress, 3, 100)}%`;
  $('progressValue').textContent = state.finished ? 'Voyage complete' : state.returnStarted ? `${Math.round(legProgress * 100)}% west` : state.visitedCalicut ? 'Calicut trade' : state.phase === 'sail-out' ? `${Math.round(legProgress * 100)}% east` : 'Prepare to sail';
  $('windName').textContent = state.wind.name;
  $('windDetail').textContent = `Toward ${cardinal(windBearing)} · ${effect.detail}`;
  const windDegrees = state.wind.angle * 180 / Math.PI;
  $('windArrow').style.transform = `rotate(${windDegrees}deg)`;
  $('headingValue').textContent = `${cardinal(headingBearing)} ${String(Math.round(headingBearing)).padStart(3, '0')}°`;
  $('windEffectValue').textContent = effect.label;
  $('windEffectValue').style.color = effect.label === 'TAILWIND' ? '#8fe0b4' : effect.label === 'HEADWIND' ? '#ff9d8f' : '#fff0c8';
  $('sailValue').textContent = `${Math.round(state.ship.sail * 100)}%`;
  $('speedValue').textContent = `${(state.ship.speed / 30).toFixed(1)} kn`;
  $('distanceValue').textContent = `${(remainingDistance() / 1000).toFixed(1)}k`;
  $('timeValue').textContent = Number.isFinite(etaSeconds()) ? formatDuration(etaSeconds()) : '--:--';
  $('hazardValue').textContent = hazard.label;
  $('hazardValue').style.color = hazard.color;
  $('efficiencyValue').textContent = `${Math.round(sailingSkill() * 100)}%`;
  // Chart marker: the player's ship slides along the highlighted ocean route and
  // its arrow points the way the ship is actually facing.
  const chartPlayer = $('chartPlayer');
  if (chartPlayer) {
    const outbound = !state.returnStarted;
    const legProgressRaw = outbound
      ? cap((state.ship.x - SHIP_START_OFFSET) / Math.max(1, state.calicutX - SHIP_START_OFFSET), 0, 1)
      : cap((state.calicutX - state.ship.x) / Math.max(1, state.calicutX - SHIP_START_OFFSET), 0, 1);
    // Kilwa (232,246) -> Calicut (470,320) along the drawn ocean path.
    const chartX = 232 + legProgressRaw * 238 + cap(state.ship.y / COURSE_CENTER, -1, 1) * 16;
    const chartY = 246 + legProgressRaw * 74;
    chartPlayer.setAttribute('transform', `translate(${chartX.toFixed(1)},${chartY.toFixed(1)}) rotate(${screenHeadingAngle(state.ship.heading).toFixed(1)})`);
    chartPlayer.classList.toggle('returning', state.returnStarted);
  }
  $('mapWindArrow').style.transform = `rotate(${windDegrees}deg)`;
  $('mapWindDirection').textContent = `Wind toward ${cardinal(windBearing)}`;
  $('mapWindEffect').textContent = `${effect.label.toLowerCase()} · ${effect.multiplier > 1 ? '+' : ''}${Math.round((effect.multiplier - 1) * 100)}% speed`;
  const actualSafetySpacing = state.returnStarted ? 1 : state.routeSafety;
  $('mapRouteInfo').textContent = `Route: ${Math.round(state.returnStarted ? state.legDistanceTotal : state.outboundDistance).toLocaleString()} units · hazard ${Math.round(activeHazardScale() * 100)}% · spacing ${Math.round(activeObstacleSpacing() * actualSafetySpacing * 100)}%`;
  const pirateSeconds = state.pirate?.phase === 'chasing' ? state.pirate.timeLeft : state.pirate?.phase === 'approaching' ? state.pirate.approachTime : 0;
  $('networkDetail').innerHTML = networkDetailHtml(hazard, pirateSeconds);
  const pirate = state.pirate;
  const pirateHud = $('pirateHud');
  pirateHud.classList.toggle('show', Boolean(pirate));
  const pirateDistance = pirate ? Math.hypot(state.ship.x - pirate.x, state.ship.y - pirate.y) : Infinity;
  pirateHud.classList.toggle('near', pirateDistance < 180 && pirate?.phase !== 'retreating');
  if (pirate) {
    const pirateBearing = bearingFromCanvasAngle(Math.atan2(pirate.y - state.ship.y, pirate.x - state.ship.x));
    const status = pirate.phase === 'approaching' ? 'APPROACHING' : pirate.phase === 'decision' ? 'CLOSING' : pirate.phase === 'chasing' ? 'CHASING' : pirate.destroyed ? 'WRECKED' : 'RETREATING';
    $('pirateAlert').textContent = pirate.phase === 'retreating' ? pirate.destroyed ? 'PIRATE DHOW WRECKED' : 'PIRATES HAVE RETREATED' : pirateDistance < 180 ? '⚠ PIRATES CLOSE!' : '⚠ PIRATES APPROACHING!';
    $('pirateStatus').textContent = pirate.phase === 'retreating' ? pirate.destroyed ? 'Dhow taking on water' : 'Dhow turning away' : `Unknown vessel from ${cardinal(pirateBearing)}`;
    $('pirateCountdown').textContent = pirate.phase === 'chasing' ? 'Steer to escape · impact proximity is dangerous' : pirate.phase === 'retreating' ? 'The dhow is sailing away' : `${Math.round(pirateDistance)} units · ${cardinal(pirateBearing)} · choose when it closes`;
    $('pirateDistance').textContent = `Distance ${Math.round(pirateDistance)} units · hull ${Math.ceil(pirate.health)}/${PIRATE_MAX_HEALTH}`;
    $('pirateDirection').textContent = `Status: ${status} · ${cardinal(pirateBearing)}`;
    $('pirateTimer').textContent = pirate.phase === 'chasing' ? `PIRATE CHASE: ${Math.ceil(pirate.timeLeft)}` : pirate.phase === 'retreating' ? (pirate.destroyed ? 'WRECKED' : 'RETREATING') : '';
    $('pirateWarning').classList.toggle('retreating', pirate.phase === 'retreating');
  }
  const consoleOutput = $('developerConsoleOutput');
  if (consoleOutput) {
    const lines = [
      'SYSTEM READY',
      `VOYAGE: ${state.phase.toUpperCase()} · ${Math.round(progress)}%`,
      `HULL: ${Math.round(hull)}%  STORES: ${Math.round(supplies)}`,
      `WIND: ${cardinal(windBearing)}  WEATHER: ${hazard.label}`,
      `PIRATE: ${pirate ? pirate.phase.toUpperCase() : 'INACTIVE'}${pirate ? ` · ${Math.round(pirateDistance)}u · hull ${Math.ceil(pirate.health)}/${PIRATE_MAX_HEALTH}` : ''}`,
    ];
    state.devHistory.slice(-8).forEach((entry) => lines.push(`> ${entry}`));
    consoleOutput.textContent = lines.join('\n');
  }
  document.querySelectorAll('[data-dev]').forEach((button) => {
    if (button.dataset.dev.startsWith('set')) return;
    button.disabled = !state.started || state.finished || state.paused || (state.phase !== 'sail-out' && state.phase !== 'sail-return');
  });
  syncPauseIndicator();
}

function modal(id, open) {
  const element = $(id);
  if (!element) return;
  element.classList.toggle('hidden', !open);
  element.setAttribute('aria-hidden', String(!open));
}

function effectImpact(effect) {
  const parts = [];
  const changed = (value) => typeof value === 'number' && Math.abs(value - 1) > .01;
  const percent = (value) => `${value >= 1 ? '+' : ''}${Math.round((value - 1) * 100)}%`;
  if (changed(effect.routeDistance)) parts.push(`route ${percent(effect.routeDistance)}`);
  if (changed(effect.routeSpeed)) parts.push(`speed ${percent(effect.routeSpeed)}`);
  if (changed(effect.routeHazard)) parts.push(`hazards ${percent(effect.routeHazard)}`);
  if (changed(effect.routeSafety)) parts.push(`safe lanes ${percent(effect.routeSafety)}`);
  if (changed(effect.obstacleSpacing)) parts.push(`spacing ${percent(effect.obstacleSpacing)}`);
  if (changed(effect.eventPower)) parts.push(`disaster intensity ${percent(effect.eventPower)}`);
  if (changed(effect.returnSpeed)) parts.push(`return speed ${percent(effect.returnSpeed)}`);
  if (changed(effect.returnHazard)) parts.push(`return hazards ${percent(effect.returnHazard)}`);
  if (changed(effect.returnObstacleSpacing)) parts.push(`return spacing ${percent(effect.returnObstacleSpacing)}`);
  return parts.join(' · ');
}

function speakerFor(id) {
  const speakers = {
    departure: ['Harbor Master', 'Kilwa harbor authority'],
    cargo: ['Supercargo', 'Merchant of Kilwa'],
    navigation: ['Navigator', 'Pilot and route keeper'],
    comparison: ['Navigator', 'Comparing routes and road networks'],
    merchant: ['Merchant', 'Calicut trading partner'],
    culture: ['Port Guide', 'Swahili, Arab, and South Asian communities'],
    disease: ['Port Clerk', 'Customs house, Calicut'],
    protection: ['Harbor Official', 'Convoy organizer'],
    return: ['Returning Pilot', 'Crew of the merchant ship'],
  };
  return speakers[id] || ['Crew', 'Indian Ocean sailors'];
}

// kind is 'chain' (a scripted story decision), 'event' (a hazard response) or
// 'crisis' (a live repair/grounding decision raised by the simulation).
function showDecision(payload, kind = 'chain', chainId = null) {
  const decision = typeof payload === 'string' ? decisions[payload] : payload;
  if (!decision) return;
  const id = decision.id || (chainId || 'crisis');
  const speaker = decision.speaker || speakerFor(id);
  if ($('decisionSceneArt')) $('decisionSceneArt').dataset.scene = decision.scene || id;
  if ($('decisionSceneCaption')) $('decisionSceneCaption').textContent = `${decision.skill || 'Decision'} · three responses`;
  if ($('decisionSpeakerName')) $('decisionSpeakerName').textContent = speaker[0];
  if ($('decisionSpeakerRole')) $('decisionSpeakerRole').textContent = speaker[1];
  state.paused = true;
  state.pausedByDecision = true;
  $('decisionKicker').textContent = kind === 'chain'
    ? `Voyage decision ${state.decisionCount + 1} · ${decision.skill}`
    : `${decision.skill} · Choose one response`;
  $('decisionTitle').textContent = decision.title;
  $('decisionBody').textContent = decision.body;
  $('reasoningCallout').textContent = decision.reasoning || '';
  const list = $('choiceList');
  list.innerHTML = '';
  decision.choices.forEach((choice) => {
    const button = document.createElement('button');
    button.className = 'choice-card';
    const impact = effectImpact(choice.effect);
    button.innerHTML = `<strong>${choice.label}</strong><small>${choice.detail}${impact ? ` · ${impact}` : ''}</small>`;
    button.addEventListener('click', () => chooseDecision(kind, choice, id));
    list.appendChild(button);
  });
  modal('modalBackdrop', true);
  state.pendingDecision = { kind, id, decision };
}

function showEncounterDecision(event, power) {
  const content = {
    storm: {
      title: 'The monsoon storm turns violent', body: 'Dark clouds race across the seasonal wind. The crew must decide whether to work with the wind or fight it.', skill: 'Monsoon seamanship', speaker: ['Captain', 'Reading the storm front'],
      choices: [['Reef and turn with the wind', 'Reduce sail and bear away; control and visibility recover.'], ['Hold a careful course', 'Keep way on, accepting a little damage and lost speed.'], ['Fight directly into the storm', 'Hard steering, steep seas, hull strain, and cargo loss.']],
    },
    waves: {
      title: 'A wall of large waves', body: 'Long swells are breaking across the route. The ship can meet them at an angle, slow down, or drive straight through.', skill: 'Reading the sea', speaker: ['Pilot', 'Watching the swell pattern'],
      choices: [['Angle across the swell', 'Ease sail and take the waves on the quarter for a steadier ride.'], ['Slow down and ride it out', 'Lose time and a little speed, but protect the hull.'], ['Keep maximum speed', 'The hull pounds hard; cargo shifts and steering becomes erratic.']],
    },
    fog: {
      title: 'The ocean disappears into fog', body: 'A dense sea fog hides reefs, other vessels, and the coastline. Your crew has a compass, a pilot, and the option to slow.', skill: 'Navigation under sail', speaker: ['Navigator', 'Taking a bearing'],
      choices: [['Use compass and soundings', 'Hold a measured bearing; visibility and steering improve.'], ['Slow down and continue', 'The crossing takes longer, but collisions remain avoidable.'], ['Keep full speed in the fog', 'Poor visibility raises collision risk and throws the ship off course.']],
    },
    wind: {
      title: 'A sudden squall reverses the wind', body: 'The wind has veered across the route. Reading its direction is safer than forcing the sail against it.', skill: 'Monsoon windcraft', speaker: ['Sailmaster', 'Reading the veering wind'],
      choices: [['Trim sail to the new wind', 'Use the wind strategically for smoother handling and speed.'], ['Reef sail and wait it out', 'Give up speed and stores while the gust passes.'], ['Ignore the wind direction', 'Gusts overpower the rig and make the helm unstable.']],
    },
    earthquake: {
      title: 'An undersea earthquake shakes the route', body: 'A seabed fault sends debris and confused currents across the passage. Choose a response before the next swell.', skill: 'Causation & seamanship', speaker: ['Pilot', 'Soundings from the quarterdeck'],
      choices: [['Keep clear of the disturbed water', 'Ease sail, steer for open water, and steady the ship.'], ['Brace and cross slowly', 'Take minor strain and spend supplies to protect the cargo.'], ['Push through the debris field', 'New impacts, lost cargo, and violent steering follow.']],
    },
    tsunami: {
      title: 'A tsunami surge crosses the passage', body: 'A powerful surge is moving through the sea. The crew must avoid its crest rather than race into it.', skill: 'Coastal hazard knowledge', speaker: ['Navigator', 'Watching the surge line'],
      choices: [['Turn across the moving surge', 'Take the swell obliquely and keep the rudder responsive.'], ['Heave to and wait', 'Lose time and stores while the worst water passes.'], ['Run straight before the surge', 'The vessel accelerates into breaking water and debris.']],
    },
    typhoon: {
      title: 'A typhoon closes around the ship', body: 'The wind and sea are building into a rotating storm. A controlled, reduced sail plan gives the crew the best chance.', skill: 'Typhoon seamanship', speaker: ['Captain', 'Securing the rigging'],
      choices: [['Heave to under reduced sail', 'Stabilize the vessel and let the worst gusts pass.'], ['Keep a slow tack', 'Accept moderate damage while maintaining steerage.'], ['Carry full sail into the typhoon', 'Extreme gusts, steep waves, and severe hull and cargo damage.']],
    },
    shortage: {
      title: 'Fresh water is running low', body: 'The casks are lighter than the manifest claimed and the crossing still has sea ahead. Stores spent now cannot be replaced on the water.', skill: 'Provisioning', speaker: ['Steward', 'Measuring the casks'],
      choices: [['Ration carefully and keep the route', 'Stretch the stores; slow progress but hold the schedule.'], ['Shorten the passage and press on', 'Spend water faster to keep the sailing days low.'], ['Open the emergency stores', 'Buy comfortable margin now at a heavy cost in speed.']],
    },
    navigation: {
      title: 'The bearings no longer agree', body: 'Cloud breaks, the swell shifts, and two of the crew give different readings of the course. Current, coast, and dead reckoning pull the ship apart.', skill: 'Navigation under sail', speaker: ['Navigator', 'Comparing three courses'],
      choices: [['Dead reckon and hold the compass bearing', 'Trust the instruments over the visual cues.'], ['Take a noon sight with the astrolabe', 'Spend daylight to fix the latitude accurately.'], ['Feel along toward the coast', 'Safer water, but a longer line and more stores.']],
    },
    pirates: {
      title: 'Pirate sails appear on the horizon', body: 'A fast dhow is closing from astern. You have seconds to choose what to protect: cargo, stores, or the ship itself.', skill: 'Trade & survival', speaker: ['Lookout', 'Pirate dhow approaching'], scene: 'pirates',
      choices: [['Throw goods overboard', 'Sacrifice one valuable good; the pirates slow to recover it.'], ['Bribe them with supplies', 'Spend stores to end the encounter before a chase begins.'], ['Run for it', `Begin a ${PIRATE_CHASE_DURATION}-second chase. Steer, use the wind, and avoid a collision.`]],
    },
  }[event.type];
  if (!content) return;
  state.pendingEvent = { ...event, power, title: content.title, skill: content.skill };
  if (event.type === 'pirates') state.pirateDecisionDeadline = performance.now() + 12000;
  showDecision({
    ...content,
    id: event.type,
    reasoning: `Historical survival decision: the response changes real sailing conditions. Hull ${Math.round(state.hull)}%, supplies ${Math.round(state.supplies)}, cargo ${cargoCount()}/6.`,
    choices: content.choices.map(([label, detail], index) => ({
      label, detail,
      effect: { response: ['good', 'mild', 'bad'][index] },
      note: detail,
    })),
  }, 'event');
}

function addCargo(ids = []) {
  ids.forEach((id) => { if (cargoCount() < 6) state.cargo.push(id); });
}

// ---------------------------------------------------------------------------
// Live crises raised by the simulation (rock strikes, shallow water)
// ---------------------------------------------------------------------------

function raiseRepairCrisis(damage) {
  const hullAfter = Math.max(6, Math.round(state.hull));
  state.pendingCrisis = { kind: 'repair', damage };
  state.crisisCount += 1;
  journalAdd('environment', `Rock strike for ${damage} hull — the ship needed a decision.`);
  showDecision({
    id: 'repair',
    title: repairCrisis.title,
    body: `${repairCrisis.body} Hull is now ${hullAfter}% and the hold holds ${cargoCount()} of 6 cargo spaces.`,
    skill: repairCrisis.skill,
    speaker: repairCrisis.speaker,
    scene: repairCrisis.scene,
    reasoning: `Cause and effect: the reef caused damage; your answer decides whether the ship is easier or harder to sail for the rest of the crossing. Hull ${hullAfter}%, stores ${Math.round(state.supplies)}.`,
    choices: repairCrisis.choices.map((choice) => ({ ...choice })),
  }, 'crisis', 'repair');
}

function resolveCrisis(choice, id) {
  const crisis = state.pendingCrisis;
  state.pendingCrisis = null;
  state.pendingDecision = null;
  state.paused = false;
  state.pausedByDecision = false;
  modal('modalBackdrop', false);
  const repair = choice.effect.repair;
  if (repair === 'full') {
    state.supplies = cap(state.supplies - 15, 0, SUPPLY_CAP);
    state.hull = Math.min(100, state.hull + Math.max(0, 80 - state.hull));
    state.repairedHull = true;
    journalAdd('environment', 'Repaired the hull properly for 15 stores; handling and survival improved.');
    recordCauseEffect('A rock strike damaged the hull', 'Spending 15 stores on a proper repair restored control and made later storms survivable');
  } else if (repair === 'patched') {
    state.supplies = cap(state.supplies - 5, 0, SUPPLY_CAP);
    state.hull = Math.min(state.hull, 60);
    state.patchedHull = true;
    journalAdd('environment', 'Patched the seams for 5 stores; the hull stayed weak for the crossing.');
    recordCauseEffect('A rock strike damaged the hull', 'A cheap patch saved stores but carried weakened hull into the rest of the voyage');
  } else {
    state.repairedHull = false;
    journalAdd('environment', 'Sailed on with the damage unrepaired; later hazards hit harder.');
    recordCauseEffect('A rock strike damaged the hull', 'Saving stores left the hull damaged, so every later collision and storm cost more');
  }
  // Give the crew room to get the ship clear of the hazard before it can be struck again.
  state.hitCooldown = Math.max(state.hitCooldown, 4);
  state.log.push({ number: state.log.length + 1, title: repairCrisis.title, choice: choice.label, skill: 'Cause and effect', note: choice.note });
  state.skills.add('Cause and effect');
  state.decisionCount += 1;
  toast(choice.note);
  showLesson(repairCrisis.lesson);
  updateHud();
}

function applyEffect(effect) {
  ['hull', 'supplies', 'money', 'trust', 'windBonus', 'navigation', 'returnWind'].forEach((key) => { if (typeof effect[key] === 'number') state[key] += effect[key]; });
  addCargo(effect.cargoAdd);
  ['cargoRisk', 'cargoDamage'].forEach((key) => { if (typeof effect[key] === 'number') state[key] += effect[key]; });
  ['routeDistance', 'routeSpeed', 'routeHazard', 'routeSafety', 'obstacleSpacing', 'eventPower', 'returnSpeed', 'returnHazard', 'returnObstacleSpacing'].forEach((key) => { if (typeof effect[key] === 'number') state[key] *= effect[key]; });
  if (typeof effect.routeCurve === 'number') state.routeCurve = effect.routeCurve;
  syncOutboundDistance();
  if (effect.merchant) state.merchant = effect.merchant;
  if (typeof effect.priceMod === 'number') state.priceMod = effect.priceMod;
  if (effect.crewIllness) {
    state.crewIllness = true;
    journalAdd('disease', 'Stayed and traded normally; the crew carried a fever west with them.');
  }
  ['stormSafe', 'culture', 'protected'].forEach((key) => { if (typeof effect[key] === 'boolean') state[key] = effect[key]; });
  state.hull = cap(state.hull, 0, 100);
  state.supplies = cap(state.supplies, 0, SUPPLY_CAP);
  state.trust = cap(state.trust, 0, 100);
}

// The story runs on two explicit chains instead of numeric indices, so adding a
// decision never renumbers the ones after it.
function advanceChain(chain, step) {
  state.chain = chain;
  state.chainStep = step;
  const list = chain === 'pre' ? PRE_VOYAGE_CHAIN : CALICUT_CHAIN;
  if (step >= list.length) return false;
  showDecision(list[step], 'chain', list[step]);
  return true;
}

function continueChain() {
  const chain = state.chain === 'calicut' ? CALICUT_CHAIN : PRE_VOYAGE_CHAIN;
  const step = state.chainStep + 1;
  if (state.chain === 'calicut') {
    // Selling the outbound hold opens the market between the merchant and
    // cultural decisions; every other step runs straight to the next one.
    if (chain[step] === 'culture') {
      playTransition('market', () => {
        settleCalicutCargo();
        modal('marketBackdrop', true);
        updateMarket();
        advanceChain('calicut', step);
      });
      return;
    }
    if (step >= chain.length) { startReturn(); return; }
    setTimeout(() => advanceChain('calicut', step), 450);
    return;
  }
  if (step >= chain.length) { beginSailing(); return; }
  setTimeout(() => advanceChain('pre', step), 450);
}

function chooseDecision(kind, choice, id) {
  if (kind === 'event') { resolveEncounter(choice); return; }
  if (kind === 'crisis') { resolveCrisis(choice, id); return; }
  const decision = decisions[id];
  if (!decision) return;
  state.pendingDecision = null;
  applyEffect(choice.effect);
  const choiceIndex = decision.choices.indexOf(choice);
  const preferredChoice = { departure: 1, cargo: 1, navigation: 0, comparison: 0, merchant: 2, culture: 0, disease: 0, protection: 0, return: 0 }[id];
  if (choiceIndex === preferredChoice) state.goodDecisions += 1;
  else if (choiceIndex === 2) state.poorDecisions += 1;
  state.log.push({ number: state.log.length + 1, title: decision.title, choice: choice.label, skill: decision.skill, note: choice.note });
  state.skills.add(decision.skill);
  state.decisionCount += 1;
  state.decisionIndex = state.chain === 'calicut' ? state.chainStep + 5 : state.chainStep + 1;
  modal('modalBackdrop', false);
  emitSound(370);
  toast(choice.note);
  recordDecisionInJournal(id, choice);
  showLesson(decision.lesson || lessonForDecision(id));
  updateHud();
  continueChain();
}

function resolveEncounter(choice) {
  const event = state.pendingEvent;
  if (!event) return;
  const response = choice.effect.response;
  const power = event.power;
  const duration = event.duration || 18;
  state.pendingEvent = null;
  state.pirateDecisionDeadline = 0;
  state.paused = false;
  state.pausedByDecision = false;
  modal('modalBackdrop', false);
  $('stormWarning').classList.remove('show');
  state.log.push({ number: state.log.length + 1, title: event.title, choice: choice.label, skill: event.skill, note: choice.note });
  state.skills.add(event.skill);

  if (event.type === 'pirates') {
    if (response === 'good') {
      if (state.cargo.length) {
        const valuable = state.cargo.reduce((best, id, index, cargo) => goods.find((good) => good.id === id).sell > goods.find((good) => good.id === cargo[best]).sell ? index : best, 0);
        const lost = state.cargo.splice(valuable, 1)[0];
        const throwX = state.ship.x + Math.cos(state.ship.heading) * 25;
        const throwY = state.ship.y + Math.sin(state.ship.heading) * 25;
        for (let piece = 0; piece < 10; piece += 1) spawnParticle('cargo', throwX, throwY, { angle: state.ship.heading + (Math.random() - .5) * 1.8, speed: 55 + Math.random() * 85, life: 1 + Math.random() * .8, size: 4 + Math.random() * 3 });
        state.cargoRisk = Math.max(0, state.cargoRisk - (goods.find((good) => good.id === lost).risk || 0));
        toast(`The crew cast ${goods.find((good) => good.id === lost).name} overboard. The pirates break off.`, true);
      } else toast('The empty hold gives the pirates nothing to seize. They break off.');
      state.pirate.phase = 'retreating';
      state.pirate.timeLeft = 4;
      state.pirate.speed = Math.max(150, state.pirate.speed);
      state.pirateEscapes += 1;
      state.goodDecisions += 1;
    } else if (response === 'mild') {
      state.supplies = cap(state.supplies - 16, 0, SUPPLY_CAP);
      state.trust = cap(state.trust - 1, 0, 100);
      state.pirate.phase = 'retreating';
      state.pirate.timeLeft = 3;
      state.pirate.speed = Math.max(180, state.pirate.speed);
      for (let coin = 0; coin < 9; coin += 1) spawnParticle('coin', state.ship.x, state.ship.y, { angle: Math.random() * Math.PI * 2, speed: 25 + Math.random() * 45, life: .7 + Math.random() * .4, size: 2 + Math.random() * 2 });
      state.pirateEscapes += 1;
      toast('The bribe costs 16 supplies; the pirate dhow turns away.', true);
    } else startPirateChase(power);
    if (response === 'bad') state.poorDecisions += 1;
    if (response !== 'bad') {
      $('pirateWarning').classList.add('show', 'retreating');
      state.pirateCooldown = 180;
      setObjective('Pirates have retreated.', 'The dhow is turning away. Continue sailing toward the coast.');
    }
    updateHud();
    return;
  }

  const good = response === 'good';
  const mild = response === 'mild';
  resolveDisasterField(response);
  if (good) state.goodDecisions += 1;
  if (!good && !mild) state.poorDecisions += 1;
  state.effects = good
    ? { control: 1.12, speed: 1.04, stability: 1.38, waves: .72, wind: .86, fog: 0, time: duration }
    : mild
      ? { control: .9, speed: .83, stability: 1.05, waves: .96, wind: .95, fog: event.type === 'fog' ? .28 : .08, time: duration }
      : { control: .58, speed: .82, stability: .56, waves: 1.55, wind: 1.42, fog: event.type === 'fog' ? .78 : .24, time: duration };
  const hazardPower = power * (good ? .48 : mild ? .84 : 1.35);
  if (good && event.type === 'storm') state.ship.sail = cap(state.ship.sail * .72, .15, 1);
  if (good && event.type === 'waves') {
    state.ship.sail = cap(state.ship.sail * .82, .15, 1);
    state.ship.heading += courseDirection * .24;
  }
  if (good && event.type === 'fog') {
    state.navigation += .1;
    state.desiredHeading = state.returnStarted ? Math.PI : 0;
  }
  if ((good && event.type === 'wind') || (mild && (event.type === 'wind' || event.type === 'waves' || event.type === 'fog'))) {
    state.ship.sail = cap(state.ship.sail * (good ? .86 : .68), .15, 1);
  }
  if (event.type === 'storm') {
    state.stormActive = true;
    state.stormIntensity = cap(hazardPower, .2, 1.5);
    state.stormTimeLeft = duration;
  } else if (event.type === 'waves') {
    state.waveSurge = hazardPower;
    state.waveTimeLeft = duration;
  } else if (event.type === 'fog') {
    state.extraFog = good ? 0 : mild ? .28 : .8;
    state.fogTimeLeft = duration;
  } else if (event.type === 'wind') {
    state.gustPower = hazardPower;
    state.gustTimeLeft = duration;
    if (good) state.wind.angle = state.ship.heading;
  } else if (event.type === 'earthquake') {
    state.earthquake = duration;
    state.quakePower = hazardPower;
  } else if (event.type === 'tsunami') {
    state.tsunami = duration;
    state.tsunamiPower = hazardPower;
  } else if (event.type === 'typhoon') {
    state.typhoon = duration;
    state.typhoonPower = hazardPower;
  } else if (event.type === 'shortage') {
    // Provisioning is pure resource pressure: the answer spends or protects stores.
    state.supplies = cap(state.supplies + (good ? 4 : mild ? -8 : -16), 0, SUPPLY_CAP);
    state.routeSpeed = state.routeSpeed * (good ? .97 : mild ? 1.02 : 1.08);
    state.legDistanceTotal = state.legDistanceTotal * (good ? .99 : mild ? 1.02 : 1.05);
    journalAdd('environment', good ? 'Rationed stores carefully and kept the schedule.' : mild ? 'Pressed on with thin water.' : 'Bought comfortable margin with a heavy cost in speed.');
  } else if (event.type === 'navigation') {
    // The instrument question: trust tools, spend daylight for a sight, or feel along.
    if (good) {
      state.navigation += .22;
      state.desiredHeading = state.returnStarted ? Math.PI : 0;
    } else if (mild) {
      state.navigation += .08;
      state.supplies = cap(state.supplies - 4, 0, SUPPLY_CAP);
    } else {
      state.navigation -= .1;
      state.hull -= 4;
      state.legDistanceTotal = state.legDistanceTotal * 1.06;
      state.cargoDamage += 1;
    }
    journalAdd('technology', good ? 'Dead-reckoned on the compass bearing and held the course.' : mild ? 'Took a noon sight with the astrolabe.' : 'Felt along to the coast and lost distance.');
  }

  if (mild) {
    state.hull -= event.type === 'fog' ? 2 : event.type === 'navigation' ? 1 : 5;
    if (event.type !== 'shortage') state.supplies = cap(state.supplies - 2, 0, SUPPLY_CAP);
  } else if (!good) {
    state.hull -= event.type === 'typhoon' || event.type === 'tsunami' ? 17 : event.type === 'navigation' ? 8 : 12;
    if (event.type !== 'shortage') state.supplies = cap(state.supplies - 9, 0, SUPPLY_CAP);
    state.cargoDamage += event.type === 'navigation' ? 0 : 1;
  } else {
    // A well-handled hazard costs the crew less: skilled sailing is rewarded so
    // success cannot come down to luck.
    state.supplies = cap(state.supplies + 5, 0, SUPPLY_CAP);
  }
  state.hull = cap(state.hull, 0, 100);
  state.hazardGrace = good ? 3 : 1;
  setObjective(good ? 'The crew has found a safer line.' : mild ? 'The crew is riding out the danger.' : 'The ship is struggling in dangerous conditions.', good ? 'Reduced sail and a considered bearing stabilize the vessel.' : mild ? 'Keep a clear lane and watch the ship’s speed and stores.' : 'The helm is unstable; steer clear of reefs and avoid the worst of the weather.');
  toast(choice.note, !good);
  showLesson(ENCOUNTER_LESSONS[event.type] || ENCOUNTER_LESSONS.default);
  emitSound(good ? 440 : mild ? 210 : 95, .16);
  updateHud();
}

// Short, event-specific lessons so the card is always tied to what just happened.
const ENCOUNTER_LESSONS = {
  storm: 'Storms made the monsoon dangerous as well as useful. Sailing crews who read the weather avoided the worst of it instead of trying to outrun it.',
  waves: 'Long swells from distant weather shaped when ships could safely make landfall; crews learned to take them at an angle rather than head-on.',
  fog: 'Visibility limited coastal navigation, so tools that worked without sight — the compass, the lead line, and the astrolabe — decided who arrived.',
  wind: 'Wind that shifts unexpectedly could not be ignored. Reading it and trimming sail was a practical skill with commercial value.',
  earthquake: 'Undersea earthquakes changed currents and scattered debris, adding an unpredictable hazard to any route.',
  tsunami: 'Rare surges showed sailors that even familiar water could become lethal, reinforcing the value of local pilot knowledge.',
  typhoon: 'The strongest seasonal storms made timing the decisive choice: crossing before or after a cyclone could decide a voyage.',
  pirates: 'Maritime trade carried risk as well as opportunity. Protecting ships, cargo, and routes affected the cost and success of long-distance exchange.',
  shortage: 'Provisioning decided how long a voyage could last. Water and food were cargo too, and the margin for error was thin.',
  navigation: 'Navigation technology helped crews manage the challenges of long-distance maritime trade, but each tool traded certainty against time.',
  default: 'Long-distance sailors balanced safety, time, cargo, and limited stores; a decision that saved resources could raise danger later.',
};

function startPirateChase(power) {
  if (!state.pirate) return;
  const preparation = cap((sailingSkill() + state.hull / 100 + state.trust / 100 - state.cargoRisk / 100) / 3, 0, 1);
  state.pirate.phase = 'chasing';
  state.pirate.timeLeft = PIRATE_CHASE_DURATION;
  state.pirate.deadline = performance.now() + PIRATE_CHASE_DURATION * 1000;
  state.pirate.power = power;
  state.pirate.health = PIRATE_MAX_HEALTH;
  state.pirate.obstacleCooldown = 0;
  state.pirate.destroyed = false;
  const windSailingPotential = BASE_SPEED * state.ship.sail * state.wind.strength * windEffect().multiplier * sailingSkill() * activeSpeedScale();
  state.pirate.maxSpeed = PIRATE_MAX_SPEED * (1 + (1 - preparation) * .18);
  state.pirate.turnRate = 1.35 + preparation * .45;
  state.pirate.acceleration = 90 + power * 18;
  state.pirate.heading = Math.atan2(state.ship.y - state.pirate.y, state.ship.x - state.pirate.x);
  state.pirate.speed = 55;
  state.cameraShake = Math.max(state.cameraShake, 5);
  $('pirateWarning').classList.add('show');
  setObjective('Escape the pirate dhow.', `The chase lasts ${PIRATE_CHASE_DURATION} seconds. Steer clear of the interceptor and use a favorable wind.`);
  toast(`Pirate chase: ${PIRATE_CHASE_DURATION} seconds. Keep the dhow from reaching your hull.`, true);
  emitSound(150, .24);
}

function updatePirate(dt) {
  const pirate = state.pirate;
  if (!pirate) return;
  if (pirate.phase === 'approaching') {
    pirate.approachTime -= dt;
    pirate.warningTime = Math.max(0, pirate.warningTime - dt);
    updatePirateSailing(pirate, dt, 0);
    pirate.obstacleCooldown = Math.max(0, pirate.obstacleCooldown - dt);
    damagePirateFromObstacle(pirate);
    const distance = Math.hypot(state.ship.x - pirate.x, state.ship.y - pirate.y);
    if (pirate.phase === 'retreating') return;
    if (pirate.warningTime === 0 && (distance <= 320 || pirate.approachTime <= 0)) {
      const dx = state.ship.x - pirate.x;
      const dy = state.ship.y - pirate.y;
      const safeDistance = Math.max(1, Math.hypot(dx, dy));
      if (safeDistance < 220) {
        pirate.x = state.ship.x - dx / safeDistance * 220;
        pirate.y = state.ship.y - dy / safeDistance * 220;
      }
      pirate.phase = 'decision';
      state.paused = true;
      state.pausedByDecision = true;
      state.ship.speed = 0;
      window.setTimeout(() => {
        if (state.pirate?.phase === 'decision' && !state.finished) showEncounterDecision(pirate.event, pirate.power);
      }, 180);
    }
    return;
  }
  if (pirate.phase === 'retreating') {
    pirate.timeLeft -= dt;
    updatePirateSailing(pirate, dt, Math.PI);
    if (pirate.timeLeft <= 0) {
      state.pirate = null;
      state.pirateCooldown = Math.max(state.pirateCooldown, 180);
      $('pirateWarning').classList.remove('show', 'retreating');
    }
    return;
  }
  if (pirate.phase !== 'chasing') return;
  pirate.timeLeft = Math.max(0, (pirate.deadline - performance.now()) / 1000);
  pirate.cooldown = Math.max(0, pirate.cooldown - dt);
  pirate.beat += dt;
  if (pirate.beat >= .78) {
    pirate.beat = 0;
    emitSound(108 + Math.round(pirate.timeLeft % 2) * 34, .12);
  }
  updatePirateSailing(pirate, dt, 0);
  pirate.obstacleCooldown = Math.max(0, pirate.obstacleCooldown - dt);
  damagePirateFromObstacle(pirate);
  if (pirate.timeLeft === 0) {
    pirate.phase = 'retreating';
    pirate.timeLeft = 4;
    pirate.maxSpeed = Math.max(pirate.maxSpeed, 170);
    state.pirateEscapes += 1;
    state.pirateCooldown = 180;
    $('pirateWarning').classList.add('retreating');
    setObjective('Pirates have retreated.', `The ${PIRATE_CHASE_DURATION}-second chase is over. The dhow is sailing away; continue the voyage.`);
    toast(`After ${PIRATE_CHASE_DURATION} seconds the pirates turn away. The voyage continues.`);
  }
}

function updatePirateSailing(pirate, dt, retreatOffset) {
  const dx = state.ship.x - pirate.x + Math.cos(state.ship.heading + retreatOffset) * 70;
  const dy = state.ship.y - pirate.y + Math.sin(state.ship.heading + retreatOffset) * 70;
  const desiredHeading = Math.atan2(dy, dx) + retreatOffset;
  const turn = angleDelta(desiredHeading, pirate.heading);
  pirate.heading += cap(turn, -pirate.turnRate * dt, pirate.turnRate * dt);
  const windRelation = Math.cos(pirate.heading - state.wind.angle);
  const windMultiplier = Math.max(.55, 1 + windRelation * .18);
  const targetSpeed = pirate.phase === 'retreating'
    ? Math.max(90, (pirate.maxSpeed || 170) * .72)
    : Math.max(55, (pirate.maxSpeed || 170) * windMultiplier);
  pirate.speed += cap(targetSpeed - pirate.speed, -pirate.acceleration * dt, pirate.acceleration * dt);
  pirate.vx = Math.cos(pirate.heading) * pirate.speed;
  pirate.vy = Math.sin(pirate.heading) * pirate.speed;
  pirate.x += pirate.vx * dt;
  pirate.y += pirate.vy * dt;
}

function damagePirateFromObstacle(pirate) {
  if (pirate.phase !== 'approaching' && pirate.phase !== 'chasing') return;
  if (pirate.obstacleCooldown > 0) return;
  const collision = obstacles.find((obstacle) => Math.hypot(pirate.x - obstacle.x, pirate.y - obstacle.y) < obstacle.r + 19);
  if (!collision) return;
  const damage = Math.round(collision.damage * PIRATE_OBSTACLE_DAMAGE_SCALE);
  pirate.health = Math.max(0, pirate.health - damage);
  pirate.obstacleCooldown = 1.15;
  const dx = pirate.x - collision.x;
  const dy = pirate.y - collision.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  pirate.x += dx / distance * 26;
  pirate.y += dy / distance * 26;
  pirate.speed *= .38;
  pirate.vx = Math.cos(pirate.heading) * pirate.speed;
  pirate.vy = Math.sin(pirate.heading) * pirate.speed;
  state.cameraShake = Math.max(state.cameraShake, 14);
  spawnParticleBurst('splash', pirate.x, pirate.y, 14, 1.15);
  emitSound(96, .16);
  if (pirate.health <= 0) {
    destroyPirate(pirate, collision);
    return;
  }
  toast(`${collision.type.toUpperCase()} WRECKS THE PIRATE DHOW: hull -${damage} (${Math.ceil(pirate.health)}/${PIRATE_MAX_HEALTH}).`, true);
  updateHud();
}

function destroyPirate(pirate, collision) {
  pirate.phase = 'retreating';
  pirate.destroyed = true;
  pirate.timeLeft = 4;
  pirate.maxSpeed = Math.max(pirate.maxSpeed, 170);
  state.pirateEscapes += 1;
  state.pirateCooldown = 180;
  $('pirateWarning').classList.add('retreating');
  setObjective('Pirate dhow wrecked!', 'The reef broke the hull. The dhow is limping away as the crew abandons the fight.');
  toast(`The pirate hull gives out against the ${collision.type.toUpperCase()}. The chase is over.`);
  spawnParticleBurst('splash', pirate.x, pirate.y, 26, 1.5);
  emitSound(70, .28);
  updateHud();
}

function damageFromPirate(pirate) {
  const dx = state.ship.x - pirate.x;
  const dy = state.ship.y - pirate.y;
  const distance = Math.hypot(dx, dy);
  if (pirate.phase !== 'chasing' || pirate.cooldown > 0 || distance > 92) return;
  const damage = Math.round(8 + pirate.power * 2);
  state.hull = Math.max(0, state.hull - damage);
  state.cargoDamage += 1;
  state.hitCooldown = Math.max(state.hitCooldown, .8);
  state.cameraShake = Math.max(state.cameraShake, 22);
  state.ship.turn += (Math.random() - .5) * 1.8;
  state.ship.vx += dx / Math.max(1, distance) * 95;
  state.ship.vy += dy / Math.max(1, distance) * 95;
  state.ship.speed *= .55;
  pirate.cooldown = 1.1;
  spawnParticleBurst('splash', state.ship.x, state.ship.y, 18, 1.35);
  toast(`Pirate dhow collision: hull -${damage}%, cargo damaged, helm thrown off.`, true);
  emitSound(78, .24);
}

function settleCalicutCargo() {
  if (state.marketPhase === 'buy') return;
  const sold = [...state.cargo];
  const reputationBefore = state.trust;
  const proceeds = sold.reduce((sum, id) => {
    const good = goods.find((item) => item.id === id);
    return sum + Math.max(6, good.sell + state.priceMod - state.cargoDamage * 2);
  }, 0);
  state.money += proceeds;
  state.marketProfit = proceeds;
  state.goodsSold += sold.length;
  state.cargo = [];
  state.cargoDamage = 0;
  state.cargoRisk = 0;
  state.marketPhase = 'buy';
  const reputationChange = sold.length ? Math.max(1, Math.min(12, Math.floor(proceeds / 18))) : 0;
  state.trust = cap(state.trust + reputationChange, 0, 100);
  state.marketReputation = state.trust - reputationBefore;
  state.marketSalesCount = sold.length;
}

function updateMarket() {
  $('marketMoney').textContent = Math.round(state.money);
  $('marketCargo').textContent = `${cargoCount()} / 6`;
  $('marketValue').textContent = Math.round(state.marketProfit + cargoValue());
  $('merchantBadge').textContent = state.merchant || 'Merchant trust';
  $('tradeSummary').textContent = `Sold ${state.marketSalesCount || 0} outbound goods for ${Math.round(state.marketProfit)} coins · merchant reputation ${state.marketReputation > 0 ? '+' : ''}${state.marketReputation || 0}. Choose return cargo or keep coins for the crossing.`;
  const leaveButton = $('leaveMarketButton');
  leaveButton.disabled = false;
  leaveButton.textContent = `Set sail for Kilwa · ${cargoCount()} goods aboard`;
  const grid = $('goodsGrid');
  grid.innerHTML = '';
  goods.forEach((good) => {
    const held = state.cargo.filter((id) => id === good.id).length;
    const buy = Math.max(5, good.buy + state.priceMod);
    const sell = Math.max(6, good.sell + state.priceMod);
    const card = document.createElement('article');
    card.className = 'good-card';
    card.innerHTML = `<span class="good-icon">${good.icon}</span><h3>${good.name}</h3><p>${good.note}</p><div class="good-meta"><span>Held ${held}</span><span>${good.risk >= 2 ? 'High value · fragile' : good.risk ? 'Moderate risk' : 'Sturdy cargo'}</span></div><div class="good-actions"><button data-buy="${good.id}" ${state.marketPhase !== 'buy' ? 'disabled' : ''}>Buy ${buy}</button><button data-sell="${good.id}" ${held ? '' : 'disabled'}>Sell ${sell}${held ? ` (${held})` : ''}</button></div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => buyGood(button.dataset.buy)));
  grid.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', () => sellGood(button.dataset.sell)));
}

function buyGood(id) {
  const good = goods.find((item) => item.id === id);
  if (state.marketPhase !== 'buy') return toast('Sell the Kilwa cargo before loading return goods.', true);
  const price = Math.max(5, good.buy + state.priceMod);
  if (cargoCount() >= 6) return toast('The hold is full. Sell or leave something behind.', true);
  if (state.money < price) return toast('Not enough coins for that cargo.', true);
  state.money -= price;
  animateCoinDelta(-price);
  state.cargo.push(id);
  state.cargoRisk += good.risk || 0;
  emitSound(520);
  updateMarket();
  updateHud();
}

function sellGood(id) {
  const index = state.cargo.indexOf(id);
  if (index < 0) return toast('You are not carrying that good.', true);
  const good = goods.find((item) => item.id === id);
  const price = Math.max(6, good.sell + state.priceMod - state.cargoDamage * 2);
  state.cargo.splice(index, 1);
  state.goodsSold += 1;
  state.money += price;
  state.cargoRisk = Math.max(0, state.cargoRisk - (good.risk || 0));
  animateCoinDelta(price);
  state.trust += 1;
  emitSound(620);
  updateMarket();
  updateHud();
}

function addObstacle({ x, y, r, type, drift = 0, disaster = false }) {
  obstacles.push({
    x, y: cap(y, -COURSE_CENTER, COURSE_CENTER), r, type,
    drift, disaster, rotation: Math.random() * Math.PI, damage: 8 + r * .2, lastHit: -10,
  });
}

function spawnObstacleWave(offset) {
  const level = currentLevel();
  const worldX = courseAnchorX + courseDirection * offset;
  const routeCenter = routePathY(worldX);
  const laneCount = level.lanes;
  const laneStart = -((laneCount - 1) * level.laneSpacing) / 2;
  const safety = state.returnStarted ? 1 : state.routeSafety;
  const obstacleCount = cap(Math.round(level.obstacleCount / safety), 1, laneCount - 1);
  const lanes = Array.from({ length: laneCount }, (_, index) => index);
  for (let index = lanes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [lanes[index], lanes[swapIndex]] = [lanes[swapIndex], lanes[index]];
  }
  // The clear lane drifts along the route instead of always sitting on the
  // charted line, so following the dashed route is no longer a guaranteed free
  // passage: the player has to read the water and find the gap. The drift is
  // smooth, which keeps it readable and fair.
  const clearDrift = Math.round(Math.sin(worldX / 2400) * 4);
  const safeLane = cap(Math.floor(laneCount / 2) + clearDrift, 0, laneCount - 1);
  const availableLanes = lanes.filter((lane) => lane !== safeLane);
  const types = ['reef', 'shoal', 'rocks', 'sandbar'];
  for (let index = 0; index < obstacleCount; index += 1) {
    const radius = level.radiusMin + Math.random() * (level.radiusMax - level.radiusMin);
    const specialChance = (level.id - 1) * .045;
    const special = Math.random() < specialChance;
    const type = special ? (Math.random() < .5 ? 'whirlpool' : 'breaker') : types[Math.floor(Math.random() * types.length)];
    addObstacle({
      x: worldX + (Math.random() - .5) * 46,
      y: routeCenter + laneStart + availableLanes[index] * level.laneSpacing + (Math.random() - .5) * 46,
      r: type === 'whirlpool' ? radius * 1.2 : radius,
      type,
      drift: type === 'breaker' ? (Math.random() - .5) * 18 : 0,
    });
  }
  obstacleSerial += 1;
  const spacing = level.rowSpacing * activeObstacleSpacing() * safety;
  nextObstacleDistance += spacing + Math.random() * spacing * .18;
}

function spawnDisasterObstacles(type, power, requestedCount) {
  const level = currentLevel();
  const count = cap(Math.round(requestedCount * activeHazardScale()), 1, 18);
  const debrisType = type === 'tsunami' ? 'wreckage' : 'debris';
  for (let index = 0; index < count; index += 1) {
    const offset = 520 + index * 145 + Math.random() * 90;
    const worldX = state.ship.x + courseDirection * offset;
    const laneSpan = ((level.lanes - 1) * level.laneSpacing) / 2;
    const y = routePathY(Math.max(0, worldX)) + (Math.random() - .5) * laneSpan * 1.7;
    addObstacle({
      x: worldX,
      y,
      r: 18 + Math.random() * (24 + power * 10),
      type: type === 'tsunami' && index % 4 === 0 ? 'wreck' : debrisType,
      drift: (Math.random() - .5) * 95 * power,
      disaster: true,
    });
  }
}

function resolveDisasterField(response) {
  const forward = (obstacle) => (obstacle.x - state.ship.x) * courseDirection;
  let retained = 0;
  obstacles = obstacles.filter((obstacle) => {
    const inDisasterLane = obstacle.disaster && forward(obstacle) >= 0 && forward(obstacle) < 5200;
    if (!inDisasterLane || response === 'bad') return true;
    if (response === 'good') return false;
    retained += 1;
    return retained % 2 === 0;
  });
}

function prepareObstacleCourse(direction, anchorX = state.ship.x) {
  courseDirection = direction;
  courseAnchorX = anchorX;
  obstacles = [];
  obstacleSerial = 0;
  nextObstacleDistance = 680;
  camera = { x: state.ship.x, y: state.ship.y, yaw: state.ship.heading, zoom: 1, zoomTarget: 1, height: VIEW.baseHeight };
  updateViewProjection();
  let lookAhead = viewLookAhead();
  let guard = 0;
  while (nextObstacleDistance < lookAhead && guard < 40) { spawnObstacleWave(nextObstacleDistance); guard += 1; }
}

function ensureObstacleCourse() {
  const lookAhead = viewLookAhead() + 320;
  const shipOffset = Math.max(0, (state.ship.x - courseAnchorX) * courseDirection);
  const targetDistance = shipOffset + lookAhead;
  let safety = 0;
  while (nextObstacleDistance < targetDistance && safety < 30) {
    spawnObstacleWave(nextObstacleDistance);
    safety += 1;
  }
  // Cull only what has fallen behind the near plane or drifted far off to the
  // side. Rows ahead of the ship are always retained, otherwise a row spawned
  // beyond the far plane would be discarded before the ship ever reached it.
  const margin = VIEW.cullMargin;
  obstacles = obstacles.filter((obstacle) => obstacleRetention(obstacle.x, obstacle.y) >= margin);
}

// How far outside the frustum an obstacle may sit and still be retained.
// Anything in front of the near plane scores a large positive value.
function obstacleRetention(worldX, worldY) {
  const dx = worldX - camera.x;
  const dy = worldY - camera.y;
  const forward = dx * view.cosYaw + dy * view.sinYaw;
  if (forward >= view.fwdMin) return 1e6;
  const depth = forward * view.cosT + view.altitude * view.sinT;
  if (depth < 14) return 1e6;
  const lateral = Math.abs(-dx * view.sinYaw + dy * view.cosYaw);
  return crossHalfAt(forward) - lateral;
}

function resetLegDisasters() {
  state.eventIndex = 0;
  state.stormTriggered = false;
  state.stormSeverity = 'standard';
  state.stormActive = false;
  state.stormIntensity = 0;
  state.stormTimeLeft = 0;
  state.earthquake = 0;
  state.quakePower = 0;
  state.tsunami = 0;
  state.tsunamiPower = 0;
  state.typhoon = 0;
  state.typhoonPower = 0;
  state.waveSurge = 0;
  state.waveTimeLeft = 0;
  state.extraFog = 0;
  state.fogTimeLeft = 0;
  state.gustPower = 0;
  state.gustTimeLeft = 0;
  state.effects = { control: 1, speed: 1, stability: 1, waves: 1, wind: 1, fog: 0, time: 0 };
  state.pendingEvent = null;
  state.pirate = null;
  $('pirateWarning').classList.remove('show');
  state.hazardGrace = 0;
}

function beginSailing() {
  state.phase = 'sail-out';
  state.paused = false;
  state.pausedByDecision = false;
  state.desiredHeading = null;
  state.legElapsed = 0;
  state.legDistanceTravelled = 0;
  resetLegDisasters();
  state.ship = { x: SHIP_START_OFFSET, y: 0, heading: 0, sail: .68, speed: 0, vx: 0, vy: 0, turn: 0, heel: 0, bob: 0, rock: 0, wake: 0 };
  state.legStartX = state.ship.x;
  syncOutboundDistance();
  state.legDistanceTotal = Math.max(1, state.outboundDistance - SHIP_START_OFFSET - PORT_ARRIVAL_RADIUS);
  state.legDistanceTravelled = 0;
  prepareObstacleCourse(1, state.ship.x);
  setObjective('Sail east and make landfall at Calicut.', `Level ${state.level}: this crossing is ${Math.round(state.legDistanceTotal).toLocaleString()} distance units.`);
}

function arriveAtCalicut() {
  state.paused = true;
  state.phase = 'market';
  state.visitedCalicut = true;
  state.calicutX = state.outboundDistance;
  state.ship.speed = 0;
  state.ship.vx = 0;
  state.ship.vy = 0;
  resetLegDisasters();
  setObjective('Trade at Calicut.', 'Your outbound hold will be sold at the market. Choose return cargo or save the proceeds for the homeward crossing.');
  toast('Landfall at Calicut. The ship has reached the coast.');
  updateHud();
  playTransition('harbor', () => window.setTimeout(() => advanceChain('calicut', 0), 220));
}

function startReturn() {
  state.returnStarted = true;
  state.phase = 'sail-return';
  state.paused = false;
  state.pausedByDecision = false;
  state.desiredHeading = null;
  state.legElapsed = 0;
  state.legDistanceTravelled = 0;
  state.calicutX = state.outboundDistance;
  resetLegDisasters();
  state.stormTriggered = true;
  state.ship = { ...state.ship, heading: Math.PI, sail: .72, speed: 0, vx: 0, vy: 0, turn: 0, heel: 0, wake: 0 };
  state.legStartX = state.ship.x;
  state.legDistanceTotal = Math.max(1, state.ship.x - PORT_ARRIVAL_RADIUS);
  state.wind = { angle: Math.PI, strength: .8, name: 'Southwest monsoon', detail: 'Wind travels west' };
  modal('marketBackdrop', false);
  prepareObstacleCourse(-1, state.ship.x);
  setObjective('Return west to Kilwa.', `Navigate ${Math.round(state.legDistanceTotal).toLocaleString()} distance units home with ${cargoCount()} return goods aboard.`);
  updateHud();
}

function finishVoyage(reason = '') {
  state.finished = true;
  state.paused = true;
  resetLegDisasters();
  const value = cargoValue();
  const wealth = state.money + value;
  state.cargoReturned = cargoCount();
  let ending;
  if (reason === 'wreck' || !state.visitedCalicut || state.hull < 20 || state.supplies <= 0) ending = { label: 'Failed expedition', title: 'The Monsoon Claims the Voyage', seal: '▲', body: `The expedition failed ${state.visitedCalicut ? 'on the return passage' : 'before reaching Calicut'}. Hull ${Math.round(state.hull)}%, supplies ${Math.round(state.supplies)}, and ${state.pirateEncounters} pirate encounter(s) tell the story: repeated strain, poor weather choices, and lost stores left no safe route home.` };
  else if (state.hull < 68 || state.supplies < 18 || wealth < 145 || state.trust < 42 || state.cargoReturned === 0 || state.cargoDamage > 0 || state.goodDecisions < 4 || state.poorDecisions > 1) ending = { label: 'Partial success', title: 'A Hard-Won Return to Kilwa', seal: '◆', body: `You completed trade at Calicut and brought the ship home, but damage, stores, cargo, profit, or risky decisions were costly. You returned ${state.cargoReturned} good(s) worth ${Math.round(value)} coins with ${Math.round(state.hull)}% hull. Strong historical choices: ${state.goodDecisions}; poor choices: ${state.poorDecisions}.` };
  else ending = { label: 'Successful expedition', title: 'A Merchant Home With the Monsoon', seal: '✦', body: `You reached Calicut, sold the outbound cargo, chose return goods, and sailed safely back to Kilwa. ${state.cargoReturned} good(s) worth ${Math.round(value)} coins returned with the ship. Seasonal windcraft, sound trade, and careful disaster decisions made the crossing succeed.` };
  $('endingLabel').textContent = ending.label;
  $('endingTitle').textContent = ending.title;
  $('endingSeal').textContent = ending.seal;
  $('endingBody').textContent = ending.body;
  const outcome = reason === 'wreck' || !state.visitedCalicut || state.hull < 20 || state.supplies <= 0 ? 'failure' : ending.label === 'Partial success' ? 'partial' : 'success';
  $('endingBackdrop').dataset.outcome = outcome;
  $('finalStats').innerHTML = `<span>Level 5 · The Monsoon Voyage</span><span>Sailed ${Math.round(state.totalDistanceSailed).toLocaleString()}</span><span>Sailing time ${formatDuration(state.totalTimeSailed)}</span><span>Journey time ${formatDuration(state.totalJourneyTime)}</span><span>Hull ${Math.round(state.hull)}%</span><span>Supplies ${Math.round(state.supplies)}</span><span>Coins ${Math.round(state.money)}</span><span>Outbound sales ${Math.round(state.marketProfit)}</span><span>Goods sold ${state.goodsSold}</span><span>Goods returned ${state.cargoReturned}</span><span>Trust ${Math.round(state.trust)}</span><span>Strong decisions ${state.goodDecisions}</span><span>Poor decisions ${state.poorDecisions}</span><span>Pirate encounters ${state.pirateEncounters}</span><span>Pirate escapes ${state.pirateEscapes}</span>`;
  renderContinuityReport();
  renderFinalReport();
  playTransition('ending', () => modal('endingBackdrop', true));
  updateHud();
  emitSound(740, .16);
}

function snapshotVoyage() {
  return {
    hull: Math.round(state.hull), supplies: Math.round(state.supplies), coins: Math.round(state.money),
    trust: Math.round(state.trust), cargo: cargoCount(), goods: cargoValue(),
  };
}

// Continuity and change: the ending compares the ship that left Kilwa with the
// ship that came back, and names what the exchanges carried besides cargo.
function renderContinuityReport() {
  const host = $('continuityReport');
  if (!host) return;
  const start = state.voyageStart || snapshotVoyage();
  const end = snapshotVoyage();
  const row = (label, from, to) => `<tr><th scope="row">${label}</th><td>${from}</td><td>${to}</td></tr>`;
  const knowledge = state.skills.size;
  host.innerHTML = `
    <h3>Continuity and change</h3>
    <p class="continuity-lede">The monsoon reversed, the ports stayed open, and the crew kept trading. Your ship did not reset between legs.</p>
    <table class="continuity-table">
      <thead><tr><th scope="col">Measure</th><th scope="col">Departing Kilwa</th><th scope="col">Returning home</th></tr></thead>
      <tbody>
        ${row('Hull', `${start.hull}%`, `${end.hull}%`)}
        ${row('Supplies', start.supplies, end.supplies)}
        ${row('Coins', start.coins, end.coins)}
        ${row('Cargo in the hold', `${start.cargo} goods`, `${end.cargo} goods`)}
        ${row('Cargo value', `${Math.round(start.goods)}`, `${Math.round(end.goods)}`)}
        ${row('Merchant trust', start.trust, end.trust)}
      </tbody>
    </table>
    <p><b>What stayed the same:</b> the seasonal wind pattern that scheduled both crossings, the reefs and weather that made the route dangerous, and the shared commercial habits of ports where several languages and faiths met.</p>
    <p><b>What changed:</b> ${knowledge} historical reasoning skill${knowledge === 1 ? '' : 's'} applied, ${state.causeEffects.length} recorded cause-and-effect link${state.causeEffects.length === 1 ? '' : 's'}, ${state.pirateEncounters} pirate encounter${state.pirateEncounters === 1 ? '' : 's'}, and a ship whose condition is the sum of every repair and every collision on the way.</p>`;
}

// The closing report ties the playthrough back to AERO 2.12.b.
function renderFinalReport() {
  const host = $('finalReport');
  if (!host) return;
  const causes = state.causeEffects.slice(-4);
  const causeList = causes.length
    ? causes.map((entry) => `<li><b>${entry.cause}</b> → ${entry.effect}.</li>`).join('')
    : '<li>No major chain reaction completed on this voyage.</li>';
  const trades = state.log.filter((entry) => ['What cargo should we carry?', 'Which merchant will receive your cargo?'].includes(entry.title));
  const tradeText = trades.length
    ? trades.map((entry) => `<li>${entry.title} → <i>${entry.choice}</i>. ${entry.note}</li>`).join('')
    : '<li>The outbound hold was settled at Calicut without a recorded trade decision.</li>';
  const networksUsed = networks.map((network) => `<li><b>${network.name}</b> (${network.kind}) — ${network.risk}; carried ${network.goods}.</li>`).join('');
  const perspectiveVoices = perspectives.map((person) => `<li><b>${person.role}:</b> “${person.wants}” ${person.voice}</li>`).join('');
  host.innerHTML = `
    <h3>Your voyage report</h3>
    <section>
      <h4>Causes and effects</h4>
      <p>Your outcome came from chains you set in motion, not from chance alone.</p>
      <ul>${causeList}</ul>
    </section>
    <section>
      <h4>Networks of exchange</h4>
      <ul>${networksUsed}</ul>
    </section>
    <section>
      <h4>Technology and innovation</h4>
      <ul>${technologies.map((tech) => `<li><b>${tech.name}</b> — ${tech.effect}</li>`).join('')}</ul>
    </section>
    <section>
      <h4>Cultural exchange</h4>
      <ul>${perspectiveVoices}</ul>
    </section>
    <section>
      <h4>Economics</h4>
      <ul>${tradeText}</ul>
      <p>Final coins ${Math.round(state.money)}, outbound sales ${Math.round(state.marketProfit)}, ${state.goodsSold} goods sold at Calicut, ${state.cargoReturned} returned.</p>
    </section>
    <section>
      <h4>Environment</h4>
      <p>Geography and weather set the terms: the monsoon scheduled both crossings, reefs and shallow water damaged the hull ${state.crashCount} time${state.crashCount === 1 ? '' : 's'}, and storms, fog, squalls, and a typhoon each demanded a response. ${state.crewIllness ? 'Illness carried in the crew also shaped the return. ' : ''}A player could always read the warning signs first.</p>
    </section>
    <section>
      <h4>Historical reasoning used</h4>
      <ul><li><b>Causation</b> — route and tool choices caused later speed, damage, and price outcomes.</li>
        <li><b>Comparison</b> — sea, desert, and mountain networks were compared before choosing a line.</li>
        <li><b>Contextualization</b> — season, hull condition, and port politics framed each decision.</li>
        <li><b>Continuity and change</b> — the reversal of the monsoon against an unchanged need to trade.</li></ul>
    </section>`;
}

function triggerStorm(eventPower = .45) {
  state.stormTriggered = true;
  state.stormSeverity = eventPower >= .8 || (currentLevel().id > 1 && (state.hull < 75 || state.crashCount > 0)) ? 'severe' : 'standard';
  state.stormActive = true;
  state.stormIntensity = cap(eventPower * (state.stormSeverity === 'severe' ? 1.15 : .95), .25, 1.25);
  state.stormTimeLeft = 99;
  state.paused = true;
  state.pausedByDecision = true;
  state.ship.speed = 0;
  $('stormWarning').classList.add('show');
  setObjective(state.stormSeverity === 'severe' ? 'A severe storm is closing in.' : 'A storm is closing in.', state.stormSeverity === 'severe' ? 'Your damaged hull makes this a high-risk choice.' : 'Your response will affect hull, speed, and control.');
}

// Developer-console and storm-warning entry point: raise the storm, then put the
// three-response survival decision in front of the player.
function beginStormEncounter(eventPower = .45) {
  const power = cap(eventPower, .2, 1.6);
  spawnDisasterObstacles('storm', power, 3 + currentLevel().id);
  triggerStorm(power);
  state.pendingEvent = { type: 'storm', power, title: 'A storm closes the horizon', skill: 'Monsoon seamanship' };
  window.setTimeout(() => showEncounterDecision({ type: 'storm', power, obstacles: 0 }, power), 250);
}

function triggerDisaster(event) {
  const level = currentLevel();
  const power = cap(event.power * activeHazardScale() * state.eventPower, .2, 1.6);
  state.hazardGrace = 2.5;
  if (event.type === 'pirates') {
    if (state.pirateCooldown > 0) return;
    spawnPirate(event, power);
    return;
  }
  if (event.type === 'storm' && !state.returnStarted && !state.stormTriggered) {
    spawnDisasterObstacles(event.type, power, event.obstacles || 3 + level.id);
    state.pendingEvent = { ...event, power, title: 'A storm closes the horizon', skill: 'Monsoon seamanship' };
    state.stormSeverity = power >= .8 ? 'severe' : 'standard';
    $('stormWarning').classList.add('show');
    window.setTimeout(() => showEncounterDecision(event, power), 250);
    return;
  }
  spawnDisasterObstacles(event.type, power, event.obstacles || 3 + level.id);
  state.paused = true;
  state.pausedByDecision = true;
  state.ship.speed = 0;
  emitSound(event.type === 'earthquake' ? 82 : event.type === 'tsunami' ? 96 : 128, .22);
  setObjective('A hazard is closing on the route.', 'Choose how to meet it. Each response changes the ship and the sea.');
  window.setTimeout(() => showEncounterDecision(event, power), 250);
}

function spawnPirate(event = { type: 'pirates', power: 1.1 }, power = event.power) {
  const debugSpawn = Boolean(event.debug);
  if (state.pirate || (!debugSpawn && state.pirateCooldown > 0)) return false;
  const encounter = ++state.pirateEncounters;
  const side = Math.random() < .5 ? -1 : 1;
  const visibleOffset = cap(Math.min(190, canvas.clientWidth * .24), 115, 220);
  const offset = debugSpawn ? Math.min(125, visibleOffset) : visibleOffset + Math.random() * 45;
  const lane = (Math.random() - .5) * 190;
  const heading = side < 0 ? 0 : Math.PI;
  const preparation = cap((sailingSkill() + state.hull / 100 + state.trust / 100 - state.cargoRisk / 100) / 3, 0, 1);
  state.pirate = {
    phase: 'approaching',
    x: state.ship.x + side * offset,
    y: cap(state.ship.y + lane, -COURSE_CENTER + 80, COURSE_CENTER - 80),
    heading,
    speed: 35,
    maxSpeed: 165 + power * 22 + (1 - preparation) * 65,
    turnRate: 1.25 + preparation * .3,
    acceleration: 92,
    vx: 0,
    vy: 0,
    approachTime: debugSpawn ? 1.2 : 4.5,
    warningTime: debugSpawn ? .25 : .9,
    timeLeft: 0,
    health: PIRATE_MAX_HEALTH,
    obstacleCooldown: 0,
    destroyed: false,
    power,
    cooldown: 0,
    beat: 0,
    event: { ...event, power },
  };
  $('pirateWarning').classList.remove('retreating');
  $('pirateWarning').classList.add('show');
  state.pirateCooldown = Math.max(state.pirateCooldown, 180);
  setObjective('Pirates approaching!', 'Keep sailing. The dhow is visible in the ocean; choose a response when it closes.');
  emitSound(150, .24);
  updateHud();
  return true;
}

function updateDisasters(dt) {
  const previousHazard = activeHazard().label;
  state.pirateCooldown = Math.max(0, state.pirateCooldown - dt);
  ['earthquake', 'tsunami', 'typhoon', 'stormTimeLeft', 'waveTimeLeft', 'fogTimeLeft', 'gustTimeLeft', 'hazardGrace'].forEach((key) => {
    if (state[key] > 0) state[key] = Math.max(0, state[key] - dt);
  });
  if (state.waveTimeLeft === 0) state.waveSurge = 0;
  if (state.fogTimeLeft === 0) state.extraFog = 0;
  if (state.gustTimeLeft === 0) state.gustPower = 0;
  if (state.effects.time > 0) {
    state.effects.time = Math.max(0, state.effects.time - dt);
    if (state.effects.time === 0) state.effects = { control: 1, speed: 1, stability: 1, waves: 1, wind: 1, fog: 0, time: 0 };
  }
  if (state.stormTimeLeft === 0) {
    state.stormActive = false;
    state.stormIntensity = 0;
  }
  if (state.pirate && ['approaching', 'decision', 'chasing', 'retreating'].includes(state.pirate.phase)) return;
  const events = currentLevel().events;
  while (state.eventIndex < events.length && legRouteProgress() >= events[state.eventIndex].at) {
    const event = events[state.eventIndex];
    state.eventIndex += 1;
    triggerDisaster(event);
    if (state.paused) return;
  }
  if (previousHazard !== 'CALM' && activeHazard().label === 'CALM') {
    toast('The hazard has passed. Steering control restored.');
    setObjective(state.returnStarted ? 'Continue west to Kilwa.' : 'Continue east to Calicut.', 'The dashed route arrows show the direction of travel.');
  }
}

function disasterControlFactor() {
  const reactionWindow = 1 - cap(state.hazardGrace / 2.5, 0, 1) * .65;
  let control = 1;
  if (state.stormActive) control *= 1 - state.stormIntensity * .48 * reactionWindow;
  if (state.earthquake > 0) control *= 1 - state.quakePower * .34 * reactionWindow;
  if (state.tsunami > 0) control *= 1 - state.tsunamiPower * .42 * reactionWindow;
  if (state.typhoon > 0) control *= 1 - state.typhoonPower * .52 * reactionWindow;
  if (state.waveTimeLeft > 0) control *= 1 - state.waveSurge * .32 * reactionWindow;
  if (state.gustTimeLeft > 0) control *= 1 - state.gustPower * .26 * reactionWindow;
  if (state.fogTimeLeft > 0) control *= 1 - state.extraFog * .14;
  return cap(control * state.effects.control, .1, 1.2);
}

function updateObstacleMotion(dt) {
  obstacles.forEach((obstacle) => {
    if (obstacle.type === 'breaker') obstacle.y += Math.sin(state.elapsed * 1.4 + obstacle.x * .01) * 26 * dt;
    if (obstacle.type === 'debris' || obstacle.type === 'wreckage' || obstacle.type === 'wreck') obstacle.y += Math.sin(state.elapsed * .8 + obstacle.x * .006) * (8 + state.wind.strength * 12) * dt;
  });
}

function applyDisasterForces(dt) {
  const ship = state.ship;
  const reaction = 1 - cap(state.hazardGrace / 2.5, 0, 1) * .7;
  obstacles.forEach((obstacle) => { if (obstacle.drift) obstacle.y += obstacle.drift * dt; });
  if (state.earthquake > 0) {
    obstacles.forEach((obstacle) => { obstacle.y += Math.sin(state.elapsed * 4.4 + obstacle.x * .012) * 48 * state.quakePower * reaction * dt; });
    ship.vy += Math.sin(state.elapsed * 6.1) * 62 * state.quakePower * reaction * dt;
  }
  if (state.tsunami > 0) {
    obstacles.forEach((obstacle) => { obstacle.y -= courseDirection * 42 * state.tsunamiPower * reaction * dt; });
    ship.vx -= courseDirection * 48 * state.tsunamiPower * reaction * dt;
    ship.vy += Math.sin(state.elapsed * 2.6) * 72 * state.tsunamiPower * reaction * dt;
  }
  if (state.typhoon > 0) {
    obstacles.forEach((obstacle) => { obstacle.y += Math.sin(state.elapsed * 3.2 + obstacle.y * .01) * 42 * state.typhoonPower * reaction * dt; });
    ship.vx += courseDirection * 68 * state.typhoonPower * reaction * dt;
    ship.vy += Math.sin(state.elapsed * 5.4) * 105 * state.typhoonPower * reaction * dt;
  }
}

function spawnParticle(type, x, y, options = {}) {
  if (particles.length > 260) particles.shift();
  const angle = options.angle ?? Math.random() * Math.PI * 2;
  const speed = options.speed ?? 20 + Math.random() * 60;
  particles.push({
    type, x, y,
    vx: Math.cos(angle) * speed + (options.vx || 0),
    vy: Math.sin(angle) * speed + (options.vy || 0),
    life: options.life ?? .6 + Math.random() * .8,
    maxLife: options.life ?? 1,
    size: options.size ?? 1.5 + Math.random() * 3,
    spin: (Math.random() - .5) * 6,
  });
}
function spawnParticleBurst(type, x, y, count, power = 1) {
  for (let index = 0; index < count; index += 1) spawnParticle(type, x, y, { speed: (28 + Math.random() * 70) * power, life: .45 + Math.random() * .7, size: 1.4 + Math.random() * 3.2 * power });
}
function updateParticles(dt) {
  particles = particles.filter((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.type === 'spray' || particle.type === 'splash' || particle.type === 'cargo' || particle.type === 'coin') particle.vy += 95 * dt;
    if (particle.type === 'smoke') { particle.vx *= .985; particle.vy -= 12 * dt; particle.size += dt * 5; }
    return particle.life > 0;
  });
}

function updateShip(dt) {
  if (!state.started || state.paused || state.finished || (state.phase !== 'sail-out' && state.phase !== 'sail-return')) return;
  const ship = state.ship;
  const level = currentLevel();
  state.elapsed += dt;
  state.legElapsed += dt;
  state.totalTimeSailed += dt;
  updateDisasters(dt);
  if (state.paused) return;
  updatePirate(dt);
  const relation = windRelation();
  const effect = windEffect(relation);
  const physics = physicsProfile();
  const weather = weatherProfile();
  const turn = (keys.a || keys.arrowleft ? -1 : 0) + (keys.d || keys.arrowright ? 1 : 0);
  const stormActive = state.stormActive && state.stormTimeLeft > 0;
  const control = disasterControlFactor();
  const reaction = 1 - cap(state.hazardGrace / 2.5, 0, 1) * .65;
  const turbulence = ((stormActive ? (Math.sin(state.elapsed * 5.7) + Math.sin(state.elapsed * 2.3 + 1.4) * .55) * state.stormIntensity * .72 : 0)
    + (state.earthquake > 0 ? Math.sin(state.elapsed * 8.2) * state.quakePower * .42 * reaction : 0)
    + (state.tsunami > 0 ? Math.sin(state.elapsed * 2.1) * state.tsunamiPower * .58 * reaction : 0)
    + (state.typhoon > 0 ? Math.sin(state.elapsed * 6.4) * state.typhoonPower * .88 * reaction : 0)
    + (state.waveTimeLeft > 0 ? Math.sin(state.elapsed * 2.8) * state.waveSurge * .7 : 0)
    + (state.gustTimeLeft > 0 ? Math.sin(state.elapsed * 4.3) * state.gustPower * .6 : 0)) / state.effects.stability;

  const desiredTurn = turn * physics.turnRate * control;
  ship.turn += (desiredTurn - ship.turn) * (1 - Math.exp(-dt * physics.turnResponse));
  if (state.desiredHeading !== null) {
    const difference = angleDelta(state.desiredHeading, ship.heading);
    ship.turn += difference * physics.turnResponse * .42;
    if (Math.abs(difference) < .018) state.desiredHeading = null;
  }
  ship.heading += ship.turn * dt + turbulence * dt;
  if (keys.w || keys.arrowup) ship.sail = cap(ship.sail + .3 * dt, .15, 1);
  if (keys.s || keys.arrowdown) ship.sail = cap(ship.sail - .3 * dt, .15, 1);
  if (state.typhoon > 0) ship.sail = cap(ship.sail + Math.sin(state.elapsed * 3.7) * .045 * state.typhoonPower * dt, .15, 1);

  const relativeWind = ship.heading - state.wind.angle;
  const crosswind = Math.sin(relativeWind);
  const stormDrag = stormActive ? 1 - state.stormIntensity * .16 : 1;
  const disasterDrag = 1 - (state.tsunami > 0 ? state.tsunamiPower * .17 : 0) - (state.earthquake > 0 ? state.quakePower * .05 : 0);
  const routeSpeed = activeSpeedScale();
  const thrust = BASE_SPEED * level.speed * routeSpeed * ship.sail * state.wind.strength * effect.multiplier * sailingSkill() * stormDrag * disasterDrag * state.effects.speed * state.effects.wind * Math.max(.78, 1 - cargoWeight() * .12);
  const windAngle = state.wind.angle;
  const windPush = state.wind.strength * physics.windForce * state.effects.wind * (.45 + Math.abs(crosswind) * .75);
  const waveAngle = timeSeconds() * .85 + courseDirection * .6;
  const wavePush = Math.sin(timeSeconds() * 1.7 + state.ship.x * .002) * physics.waveForce * state.effects.waves * (.35 + weather.waveHeight / 30);
  const currentAngle = windAngle + Math.sin(timeSeconds() * .11) * .62;
  const currentPush = physics.currentForce * (.4 + weather.severity * .55);
  const desiredVx = Math.cos(ship.heading) * thrust + Math.cos(windAngle) * windPush + Math.cos(waveAngle) * wavePush + Math.cos(currentAngle) * currentPush;
  const desiredVy = Math.sin(ship.heading) * thrust + Math.sin(windAngle) * windPush + Math.sin(waveAngle) * wavePush + Math.sin(currentAngle) * currentPush;
  const velocityResponse = 1 - Math.exp(-dt * physics.acceleration);
  ship.vx += (desiredVx - ship.vx) * velocityResponse;
  ship.vy += (desiredVy - ship.vy) * velocityResponse;
  updateObstacleMotion(dt);
  applyDisasterForces(dt);
  obstacles.forEach((obstacle) => {
    if (obstacle.type !== 'whirlpool') return;
    const dx = obstacle.x - ship.x;
    const dy = obstacle.y - ship.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 330 && distance > 1) {
      const pull = (1 - distance / 330) * 88 * (1 + weather.severity * .3);
      ship.vx += dx / distance * pull * dt;
      ship.vy += dy / distance * pull * dt;
    }
  });
  if (state.tsunami > 0) {
    const courseVelocity = ship.vx * courseDirection;
    const maximumReverse = 42 + currentLevel().id * 3;
    if (courseVelocity < -maximumReverse) ship.vx += courseDirection * (-maximumReverse - courseVelocity);
  }
  const laneCorrection = cap((routePathY(ship.x) - ship.y) * 1.15 - ship.vy * 1.3, -95, 95);
  ship.vy += laneCorrection * dt;
  ship.speed = Math.min(physics.maxSpeed, Math.hypot(ship.vx, ship.vy));
  if (ship.speed > physics.maxSpeed) {
    ship.vx *= physics.maxSpeed / ship.speed;
    ship.vy *= physics.maxSpeed / ship.speed;
  }
  ship.heel += (-crosswind * state.wind.strength * .34 + Math.sin(timeSeconds() * 1.9) * weather.severity * .08 - ship.heel) * (1 - Math.exp(-dt * 4));
  ship.bob = Math.sin(timeSeconds() * 2.1) * (1.5 + weather.waveHeight * .32);
  ship.rock = Math.sin(timeSeconds() * 1.35 + 1.2) * weather.severity * .05;
  ship.wake += (cap(ship.speed / 420, 0, 1.4) - ship.wake) * (1 - Math.exp(-dt * 3));
  if (weather.rain > .45 && Math.random() < dt * weather.rain * .18) {
    state.lightningFlash = 1;
    state.lightningX = .15 + Math.random() * .7;
  }
  const previousX = ship.x;
  const previousY = ship.y;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  const sailedThisFrame = Math.hypot(ship.x - previousX, ship.y - previousY);
  state.legDistanceTravelled += sailedThisFrame;
  state.totalDistanceSailed += sailedThisFrame;
  const bowX = ship.x + Math.cos(ship.heading) * 31;
  const bowY = ship.y + Math.sin(ship.heading) * 31;
  if (ship.speed > 70 && Math.random() < dt * (2 + ship.speed / 95) * weather.spray) {
    const side = Math.random() > .5 ? 1 : -1;
    spawnParticle('spray', bowX, bowY, { angle: ship.heading + side * (.6 + Math.random() * .5), speed: 30 + ship.speed * .12, life: .35 + Math.random() * .4, size: 1.4 + Math.random() * 2.4 });
  }
  if (state.hull < 58 && Math.random() < dt * (state.hull < 28 ? 6 : 2.2)) {
    spawnParticle('smoke', ship.x + Math.cos(ship.heading) * 4, ship.y + Math.sin(ship.heading) * 4, { speed: 8, life: 1.4, size: 4 + Math.random() * 4 });
  }
  if (ship.y < -COURSE_CENTER || ship.y > COURSE_CENTER) {
    ship.y = cap(ship.y, -COURSE_CENTER, COURSE_CENTER);
    ship.vy *= -.32;
    ship.vx *= .88;
    toast('Open-ocean boundary. Turn back toward the shipping lane.', true);
  }
  const destination = destinationPort();
  const routeLimit = destination.x + destination.side * (PORT_LAND_RADIUS * .72);
  if ((destination.side > 0 && ship.x > routeLimit) || (destination.side < 0 && ship.x < routeLimit)) {
    ship.x = routeLimit;
    ship.vx *= -.22;
    ship.vy *= .8;
    toast('The coastline blocks the route. Turn toward the harbor.', true);
  }
  state.cameraShake = Math.max(0, state.cameraShake - dt * 26);
  state.supplies = cap(state.supplies - dt * (.021 + level.id * .0016), 0, SUPPLY_CAP);
  state.hitCooldown = Math.max(0, state.hitCooldown - dt);
  state.crisisCooldown = Math.max(0, state.crisisCooldown - dt);
  if (state.autoHelm && !state.paused && !state.pendingCrisis && !state.pendingEvent) autoHelmTick();
  if (keys.space) {
    state.brace = .18;
    state.supplies = cap(state.supplies - dt * .09, 0, SUPPLY_CAP);
  } else state.brace = 0;

  ensureObstacleCourse();
  if (state.hitCooldown === 0) {
    const visibilityRisk = 1 + weather.fog * .7;
    const collision = obstacles.find((obstacle) => Math.hypot(ship.x - obstacle.x, ship.y - obstacle.y) < obstacle.r + 17 * visibilityRisk);
    if (collision) {
      const damage = Math.ceil(collision.damage * (state.brace ? .42 : 1));
      const dx = ship.x - collision.x;
      const dy = ship.y - collision.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      // Push the hull clear of the hazard instead of only nudging it, so the ship
      // cannot grind against the same rock and take repeated strikes.
      const pushOut = collision.r + 34 - distance;
      ship.x += dx / distance * Math.max(28, pushOut);
      ship.y += dy / distance * Math.max(28, pushOut);
      ship.vx += dx / distance * 150;
      ship.vy += dy / distance * 150;
      state.hull -= damage;
      state.crashCount += 1;
      state.hitCooldown = 2.2;
      state.cargoDamage += state.brace ? 0 : 1;
      state.cameraShake = Math.max(state.cameraShake, 18);
      ship.speed *= .32;
      ship.vx *= .32;
      ship.vy *= .32;
      spawnParticleBurst('splash', ship.x, ship.y, 14, 1.2);
      toast(`${collision.type.toUpperCase()} STRIKE: hull -${damage}%. Brace with Space or change course.`, true);
      emitSound(110, .17);
      if (state.hull <= 0) {
        state.hull = Math.max(0, state.hull);
        finishVoyage('wreck');
        return;
      }
      // A strike leaves a choice behind: spend stores to repair, patch cheaply,
      // or sail on damaged. The answer changes every later hazard.
      if (state.crisisCooldown === 0 && !state.pendingCrisis && collision.damage >= 6) {
        state.crisisCooldown = 14;
        raiseRepairCrisis(damage);
        return;
      }
    }
  }

  if (state.pirate) damageFromPirate(state.pirate);

  if (state.finished) return;
  const distanceToDestination = Math.hypot(ship.x - destination.x, ship.y - destination.y);
  if (distanceToDestination <= PORT_ARRIVAL_RADIUS) {
    if (state.returnStarted) finishVoyage();
    else arriveAtCalicut();
    return;
  }
  if (state.hull <= 0 || state.supplies <= 0) {
    state.hull = Math.max(0, state.hull);
    state.supplies = Math.max(0, state.supplies);
    finishVoyage();
  }
}

function parseHexColor(hex) {
  if (hex.startsWith('rgb')) {
    const parts = hex.match(/[\d.]+/g).map(Number);
    return [parts[0], parts[1], parts[2]];
  }
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}
function mixColor(from, to, amount) {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  return `rgb(${Math.round(cap(a[0] + (b[0] - a[0]) * amount, 0, 255))},${Math.round(cap(a[1] + (b[1] - a[1]) * amount, 0, 255))},${Math.round(cap(a[2] + (b[2] - a[2]) * amount, 0, 255))})`;
}
function dayProgress() {
  if (state.finished) return 1;
  if (state.phase === 'prepare') return .04;
  return state.returnStarted ? .5 + legRouteProgress() * .5 : legRouteProgress() * .5;
}
function dayPalette(progress = dayProgress()) {
  const stops = [
    { at: 0, top: '#79b9cf', horizon: '#f0d2a0', light: '#ffe3ab' },
    { at: .36, top: '#4f9fbe', horizon: '#d5e8df', light: '#fff0c4' },
    { at: .7, top: '#4a6f9f', horizon: '#ee9b68', light: '#ffc07a' },
    { at: 1, top: '#081a35', horizon: '#1d3559', light: '#9db6d6' },
  ];
  let from = stops[0];
  let to = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (progress >= stops[index].at && progress <= stops[index + 1].at) { from = stops[index]; to = stops[index + 1]; break; }
  }
  const amount = cap((progress - from.at) / Math.max(.001, to.at - from.at), 0, 1);
  return { top: mixColor(from.top, to.top, amount), horizon: mixColor(from.horizon, to.horizon, amount), light: mixColor(from.light, to.light, amount), night: cap((progress - .62) / .38, 0, 1) };
}
function drawCloudShadows(time, weather, palette) {
  const shadow = palette.night > .45 ? '4,10,26' : '12,42,52';
  const strength = (.05 + weather.darkness * .3) * (1 - palette.night * .35);
  if (strength < .012) return;
  const cellForward = 620;
  const cellCross = 760;
  const driftForward = time * (.0011 + state.wind.strength * .0016) * Math.cos(state.wind.angle);
  const driftCross = time * (.0011 + state.wind.strength * .0016) * Math.sin(state.wind.angle);
  const firstForward = Math.floor((view.fwdMin - cellForward) / cellForward);
  const lastForward = Math.ceil((view.fwdMax + cellForward) / cellForward);
  for (let row = firstForward; row <= lastForward; row += 1) {
    const forwardBase = row * cellForward;
    const half = crossHalfAt(forwardBase) + cellCross;
    const firstCross = Math.floor((-half - cellCross) / cellCross);
    const lastCross = Math.ceil((half + cellCross) / cellCross);
    for (let column = firstCross; column <= lastCross; column += 1) {
      const seed = seededNoise(row * 23.7 + column * 51.3);
      if (seed < .42) continue;
      const forward = forwardBase + seededNoise(seed * 91) * cellForward + driftForward;
      const lateral = column * cellCross + seededNoise(seed * 173) * cellCross + driftCross;
      const point = projectForwardLateral(forward, lateral, pathPoint);
      if (!point.ok) continue;
      const radius = (150 + seededNoise(seed * 211) * 260) * point.scale;
      if (radius < 2) continue;
      const blob = ctx.createRadialGradient(point.x, point.y, 1, point.x, point.y, radius);
      blob.addColorStop(0, `rgba(${shadow},${strength * (.5 + seed * .5)})`);
      blob.addColorStop(1, `rgba(${shadow},0)`);
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, radius, radius * view.sinT * .9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Atmospheric depth over the water itself. This is haze on a receding sea
// surface, not a sky: it tints the far water toward the horizon tone.
function drawAtmosphereHaze(width, height, weather, palette) {
  const band = Math.min(190, height * .3);
  const hazeRgb = parseHexColor(palette.horizon);
  const haze = ctx.createLinearGradient(0, -10, 0, band);
  haze.addColorStop(0, `rgba(${hazeRgb[0]},${hazeRgb[1]},${hazeRgb[2]},${.34 + weather.fog * .3})`);
  haze.addColorStop(.42, `rgba(${hazeRgb[0]},${hazeRgb[1]},${hazeRgb[2]},${.14 + weather.fog * .2})`);
  haze.addColorStop(1, `rgba(${hazeRgb[0]},${hazeRgb[1]},${hazeRgb[2]},0)`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, band);
  const depthShade = ctx.createLinearGradient(0, height * .55, 0, height);
  depthShade.addColorStop(0, 'rgba(2,20,32,0)');
  depthShade.addColorStop(1, `rgba(2,14,26,${.16 + weather.darkness * .16})`);
  ctx.fillStyle = depthShade;
  ctx.fillRect(0, height * .55, width, height * .45);
}
function drawWaterBase(width, height, weather, palette) {
  const night = palette.night;
  const nearTone = mixColor('#04364c', '#010812', night * .86 + weather.darkness * .16);
  const midTone = mixColor('#0a6a7b', '#052036', night * .8 + weather.darkness * .18);
  const farTone = mixColor('#2b93a1', '#123b58', night * .58 + weather.darkness * .2);
  const haze = mixColor(farTone, palette.horizon, .3 + weather.fog * .4);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, haze);
  gradient.addColorStop(.16, mixColor(haze, farTone, .55));
  gradient.addColorStop(.42, farTone);
  gradient.addColorStop(.62, midTone);
  gradient.addColorStop(1, nearTone);
  ctx.fillStyle = gradient;
  ctx.fillRect(-80, -40, width + 160, height + 80);
}

// Broad, slow swell patches. Each blob is an ellipse projected onto the tilted
// water plane so the surface keeps a sense of volume at any zoom level.
function drawSwellTexture(time, weather) {
  const cellForward = 480;
  const cellCross = 620;
  const firstForward = Math.floor((view.fwdMin - cellForward) / cellForward);
  const lastForward = Math.ceil((view.fwdMax + cellForward) / cellForward);
  for (let row = firstForward; row <= lastForward; row += 1) {
    const forwardBase = row * cellForward;
    const half = crossHalfAt(forwardBase) + cellCross;
    const firstCross = Math.floor((-half - cellCross) / cellCross);
    const lastCross = Math.ceil((half + cellCross) / cellCross);
    for (let column = firstCross; column <= lastCross; column += 1) {
      const seed = seededNoise(column * .013 + row * .021);
      if (seed < .34) continue;
      const forward = forwardBase + seededNoise(seed * 91) * cellForward;
      const lateral = column * cellCross + seededNoise(seed * 57) * cellCross;
      const point = projectForwardLateral(forward, lateral, pathPoint);
      if (!point.ok) continue;
      const radius = (110 + seed * 170) * point.scale;
      if (radius < 3) continue;
      ctx.fillStyle = `rgba(4,54,72,${.03 + seed * .045})`;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, radius, radius * view.sinT * .78, seed * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Sun or moon glitter scattered across the water towards the light bearing.
function drawSunGlitter(time, weather, palette) {
  const light = palette.night > .5 ? '214,228,255' : '255,240,198';
  const strength = (1 - palette.night) * .5 + palette.night * .22;
  if (strength < .04) return;
  const sunBearing = -.9 + dayProgress() * 2.1;
  const cell = 260;
  const half = crossHalfAt(view.fwdMin) + cell;
  const firstForward = Math.floor((view.fwdMin - cell) / cell);
  const lastForward = Math.ceil((view.fwdMax + cell) / cell);
  const firstCross = Math.floor((-half - cell) / cell);
  const lastCross = Math.ceil((half + cell) / cell);
  const twinkle = time * .0016;
  for (let row = firstForward; row <= lastForward; row += 1) {
    for (let column = firstCross; column <= lastCross; column += 1) {
      const seed = seededNoise(row * 7.3 + column * 13.9);
      if (seed < .68) continue;
      const forward = row * cell + seededNoise(seed * 61) * cell;
      const lateral = column * cell + seededNoise(seed * 97) * cell;
      const facing = 1 - Math.abs(((column * cell) / Math.max(1, half) - .5)) * 1.2;
      if (facing <= 0) continue;
      const point = projectForwardLateral(forward, lateral, pathPoint);
      if (!point.ok) continue;
      const radius = cap((5 + seededNoise(seed * 41) * 9) * point.scale, .5, 4);
      ctx.fillStyle = `rgba(${light},${(.16 + seededNoise(seed * 13) * .3) * strength * facing * (1 - weather.fog * .5)})`;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, radius * 2.4, radius * .8, sunBearing, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function drawOceanSurface(time, weather, palette) {
  const layers = [
    { spacing: 74, amplitude: .3, speed: .00105, alpha: .17, width: 1.5 },
    { spacing: 138, amplitude: .56, speed: .00072, alpha: .15, width: 2.1 },
    { spacing: 232, amplitude: .9, speed: .00046, alpha: .12, width: 3 },
  ];
  layers.forEach((layer, layerIndex) => {
    const amplitude = Math.max(1.2, weather.waveHeight * layer.amplitude);
    const speed = time * layer.speed * (.7 + weather.windSpeed);
    const crestBias = layerIndex * 1.7 + state.wind.angle;
    const firstRow = Math.floor(view.fwdMin / layer.spacing) * layer.spacing;
    for (let row = firstRow; row < view.fwdMax + layer.spacing; row += layer.spacing) {
      const half = crossHalfAt(row) + 70;
      const step = cap(half * .022, 20, 60);
      const reference = projectForwardLateral(row, 0, framePoint);
      if (!reference.ok) continue;
      const lineWidth = Math.max(.45, layer.width * reference.scale);
      const alpha = layer.alpha * (1 - weather.darkness * .3);
      ctx.beginPath();
      let started = false;
      for (let lateral = -half; lateral <= half; lateral += step) {
        const waveRow = row
          + Math.sin(lateral * .0085 + speed + crestBias) * amplitude
          + Math.sin(lateral * .026 - speed * 1.4) * amplitude * .28;
        const point = projectForwardLateral(waveRow, lateral, pathPoint);
        if (!point.ok) { started = false; continue; }
        if (started) ctx.lineTo(point.x, point.y);
        else { ctx.moveTo(point.x, point.y); started = true; }
      }
      ctx.strokeStyle = `rgba(214,248,238,${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      ctx.beginPath();
      started = false;
      for (let lateral = -half; lateral <= half; lateral += step) {
        const crest = Math.sin(lateral * .0085 + speed + crestBias) > .74;
        if (!crest) { started = false; continue; }
        const waveRow = row
          + Math.sin(lateral * .0085 + speed + crestBias) * amplitude
          + Math.sin(lateral * .026 - speed * 1.4) * amplitude * .28;
        const point = projectForwardLateral(waveRow, lateral, pathPoint);
        if (!point.ok) { started = false; continue; }
        if (started) ctx.lineTo(point.x, point.y);
        else { ctx.moveTo(point.x, point.y); started = true; }
      }
      ctx.strokeStyle = `rgba(255,255,240,${alpha * .55})`;
      ctx.lineWidth = Math.max(.35, lineWidth * .5);
      ctx.stroke();
    }
  });
  if (palette.night > 0 || weather.darkness > 0) {
    const tint = ctx.createLinearGradient(0, 0, 0, view.height);
    tint.addColorStop(0, `rgba(2,12,30,${palette.night * .1 + weather.darkness * .05})`);
    tint.addColorStop(1, `rgba(2,12,30,${palette.night * .26 + weather.darkness * .14})`);
    ctx.fillStyle = tint;
    ctx.fillRect(-80, -40, view.width + 160, view.height + 80);
  }
}
function drawParticles() {
  particles.forEach((particle) => {
    const point = projectWorld(particle.x, particle.y, particle.type === 'smoke' ? particle.size * 2 : 0, pathPoint);
    if (!point.ok) return;
    if (point.x < -40 || point.x > view.width + 40 || point.y < -40 || point.y > view.height + 40) return;
    const alpha = cap(particle.life / particle.maxLife, 0, 1);
    const size = Math.max(.4, particle.size * point.scale);
    if (particle.type === 'smoke') {
      ctx.fillStyle = `rgba(52,48,45,${alpha * .28})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
      ctx.fill();
    } else if (particle.type === 'cargo') {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(particle.spin * (1 - alpha));
      ctx.fillStyle = `rgba(151,101,51,${alpha})`;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeStyle = `rgba(238,204,142,${alpha})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    } else if (particle.type === 'coin') {
      ctx.fillStyle = `rgba(255,213,112,${alpha})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = particle.type === 'splash' ? `rgba(236,255,250,${alpha * .8})` : `rgba(205,244,246,${alpha * .62})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
function drawRain(time, width, height, weather) {
  if (weather.rain <= .02) return;
  const count = Math.round(34 + weather.rain * 105);
  const angle = state.wind.angle;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  ctx.save();
  ctx.strokeStyle = `rgba(205,235,245,${.16 + weather.rain * .28})`;
  ctx.lineWidth = 1.1;
  for (let index = 0; index < count; index += 1) {
    const x = (seededNoise(index * 7.1) * width + time * (.16 + weather.rain * .2) * (60 + index % 5 * 16)) % (width + 80) - 40;
    const y = (seededNoise(index * 13.7) * height + time * (.45 + weather.rain * .55) * (110 + index % 7 * 22)) % (height + 90) - 45;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - directionX * (8 + weather.rain * 13), y - directionY * (8 + weather.rain * 13) + 20);
    ctx.stroke();
  }
  ctx.restore();
}
function drawFogAndLightning(width, height, weather) {
  if (weather.fog > .02) {
    const fog = ctx.createLinearGradient(0, 0, 0, height);
    fog.addColorStop(0, `rgba(196,214,210,${weather.fog * .2})`);
    fog.addColorStop(.5, `rgba(186,206,204,${weather.fog * .08})`);
    fog.addColorStop(1, `rgba(168,192,192,${weather.fog * .16})`);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, width, height);
  }
  if (state.lightningFlash > 0) {
    ctx.fillStyle = `rgba(226,240,255,${state.lightningFlash * .34})`;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = `rgba(248,252,255,${state.lightningFlash * .9})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    let boltX = width * state.lightningX;
    let boltY = 0;
    ctx.moveTo(boltX, boltY);
    while (boltY < height * .52) {
      boltX += (seededNoise(boltY + state.elapsed) - .5) * 34;
      boltY += 22 + seededNoise(boltY * .3) * 24;
      ctx.lineTo(boltX, boltY);
    }
    ctx.stroke();
  }
}

function drawOcean(time) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const weather = weatherProfile();
  const daylight = dayPalette(dayProgress());

  const hazardShake = (state.stormActive ? state.stormIntensity * 3 : 0)
    + (state.earthquake > 0 ? state.quakePower * 7 : 0)
    + (state.typhoon > 0 ? state.typhoonPower * 5 : 0)
    + (state.tsunami > 0 ? state.tsunamiPower * 2 : 0);
  const shake = state.cameraShake + hazardShake;
  view.shakeX = Math.sin(time * .031) * shake;
  view.shakeY = Math.cos(time * .037) * shake;
  updateViewProjection();

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(view.shakeX, view.shakeY);

  drawWaterBase(width, height, weather, daylight);
  drawSwellTexture(time, weather);
  drawOceanSurface(time, weather, daylight);
  drawSunGlitter(time, weather, daylight);
  drawBathymetry(time);
  drawCloudShadows(time, weather, daylight);
  drawRoute(time);
  drawShippingLane();
  drawDecorativeIslands(time);
  if (isVisible(state.outboundDistance, 0, 900)) drawPort(state.outboundDistance, 0, 'CALICUT', 'Malabar Coast', 1, time);
  if (isVisible(0, 0, 900)) drawPort(0, 0, 'KILWA KISIWANI', 'East African coast', -1, time);
  obstacles.forEach((obstacle) => drawObstacle(obstacle, time));
  if (state.pirate) drawPirateShip(state.pirate, time);
  drawShip(time);
  drawParticles();
  drawWindField(time, weather);
  ctx.restore();

  drawAtmosphereHaze(width, height, weather, daylight);
  drawOffscreenMarkers(width, height, time);
  const compass = compassSpot(40);
  drawCompass(compass.x, compass.y);
  drawEarthquakeOverlay(time, width, height);
  drawTsunamiOverlay(time, width, height);
  drawStormOverlay(time, width, height);
  drawTyphoonOverlay(time, width, height);
  drawRain(time, width, height, weather);
  drawFogAndLightning(width, height, weather);
}

// Clamps an off-screen world point to a point on the viewport edge, keeping the
// marker clear of the HUD cards that hug the top and bottom edges.
function edgeAnchor(screenX, screenY) {
  const side = 78;
  const top = 74;
  const bottom = 108;
  const minX = view.anchorX - (view.width / 2 - side);
  const maxX = view.anchorX + (view.width / 2 - side);
  const minY = view.anchorY - (view.height / 2 - top);
  const maxY = view.anchorY + (view.height / 2 - bottom);
  if (maxX <= minX || maxY <= minY) return null;
  const offsetX = screenX - view.anchorX;
  const offsetY = screenY - view.anchorY;
  if (offsetX > minX && offsetX < maxX && offsetY > minY && offsetY < maxY) return null;
  const scale = Math.min(
    Math.abs((maxX - view.anchorX) / (offsetX || 1e-3)),
    Math.abs((maxY - view.anchorY) / (offsetY || 1e-3)),
  );
  return {
    x: view.anchorX + offsetX * scale,
    y: view.anchorY + offsetY * scale,
    angle: Math.atan2(offsetY, offsetX),
  };
}

function drawEdgeMarker(anchor, color, label, detail) {
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(anchor.angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-9, -8);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-9, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (!label) return;
  const left = anchor.x > view.anchorX;
  ctx.textAlign = left ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const textX = anchor.x + (left ? -18 : 18);
  ctx.font = '9px DM Mono, monospace';
  const boxWidth = Math.max(96, ctx.measureText(detail || label).width + 22);
  ctx.fillStyle = 'rgba(4,26,36,.72)';
  ctx.fillRect(left ? textX - boxWidth : textX, anchor.y - 15, boxWidth, 30);
  ctx.fillStyle = color;
  ctx.font = '700 10px DM Mono, monospace';
  ctx.fillText(label, textX, anchor.y - 4);
  if (detail) {
    ctx.fillStyle = '#bfe1d7';
    ctx.font = '9px DM Mono, monospace';
    ctx.fillText(detail, textX, anchor.y + 8);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawOffscreenMarkers(width, height, time) {
  const destination = destinationPort();
  const destinationPoint = projectWorld(destination.x, destination.y, 0, projection);
  const distance = Math.round(Math.hypot(destination.x - state.ship.x, destination.y - state.ship.y));
  if (destinationPoint.ok) {
    const anchor = edgeAnchor(destinationPoint.x, destinationPoint.y);
    if (anchor) drawEdgeMarker(anchor, '#ffe1a0', destination.name, `${distance.toLocaleString()} units · ${cardinal(bearingFromCanvasAngle(Math.atan2(destination.y - state.ship.y, destination.x - state.ship.x)))}`);
  }
  if (state.pirate) {
    const piratePoint = projectWorld(state.pirate.x, state.pirate.y, 0, projection);
    if (piratePoint.ok) {
      const anchor = edgeAnchor(piratePoint.x, piratePoint.y);
      if (anchor) {
        const label = state.pirate.phase === 'retreating' ? 'PIRATE DHOW' : state.pirate.phase === 'chasing' ? 'PIRATE CHASE' : 'PIRATE APPROACH';
        drawEdgeMarker(anchor, state.pirate.phase === 'retreating' ? '#8fd6a2' : '#ff6a51', label, `${Math.round(Math.hypot(state.pirate.x - state.ship.x, state.pirate.y - state.ship.y))} units`);
      }
    }
  }
}

function drawBathymetry(time) {
  const rowSpacing = 155;
  for (let row = Math.floor(view.fwdMin / rowSpacing) * rowSpacing; row < view.fwdMax; row += rowSpacing) {
    const half = crossHalfAt(row) + 40;
    const step = cap(half * .05, 26, 70);
    ctx.beginPath();
    let started = false;
    for (let lateral = -half; lateral <= half; lateral += step) {
      const waveRow = row + Math.sin(lateral * .009 + row * .014 + time * .0012) * 13 + Math.sin(lateral * .023 - row * .01) * 5;
      const point = projectForwardLateral(waveRow, lateral, pathPoint);
      if (!point.ok) { started = false; continue; }
      if (started) ctx.lineTo(point.x, point.y);
      else { ctx.moveTo(point.x, point.y); started = true; }
    }
    ctx.strokeStyle = 'rgba(197,240,224,.11)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const columnSpacing = 320;
  const maxHalf = crossHalfAt(view.fwdMax) + 40;
  const forwardStep = cap((view.fwdMax - view.fwdMin) * .04, 24, 80);
  for (let lateral = Math.floor(-maxHalf / columnSpacing) * columnSpacing; lateral <= maxHalf; lateral += columnSpacing) {
    ctx.beginPath();
    let started = false;
    for (let forward = view.fwdMin; forward <= view.fwdMax + forwardStep; forward += forwardStep) {
      const point = projectForwardLateral(forward, lateral, pathPoint);
      if (!point.ok) { started = false; continue; }
      if (started) ctx.lineTo(point.x, point.y);
      else { ctx.moveTo(point.x, point.y); started = true; }
    }
    ctx.strokeStyle = 'rgba(215,243,225,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawRoute(time) {
  const reach = 2200 + view.altitude;
  const step = cap(view.altitude * .05, 40, 110);
  const segments = [];
  let run = null;
  for (let worldX = camera.x - reach; worldX <= camera.x + reach; worldX += step) {
    const worldY = routePathY(worldX);
    const point = projectWorld(worldX, worldY, 0, pathPoint);
    if (!point.ok) { if (run) { segments.push(run); run = null; } continue; }
    if (!run) run = [];
    run.push(point.x, point.y);
  }
  if (run) segments.push(run);
  ctx.save();
  ctx.setLineDash([12, 16]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,221,139,.42)';
  segments.forEach((segment) => {
    if (segment.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(segment[0], segment[1]);
    for (let index = 2; index < segment.length; index += 2) ctx.lineTo(segment[index], segment[index + 1]);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.restore();

  const markerSpacing = state.outboundDistance / 10;
  const travel = (time * .00006 * BASE_SPEED) % markerSpacing;
  for (let index = 0; index < 10; index += 1) {
    const eastwardOffset = travel + index * markerSpacing;
    const worldX = courseDirection > 0 ? eastwardOffset : state.outboundDistance - eastwardOffset;
    if (worldX < -300 || worldX > state.outboundDistance + 300) continue;
    if (!isVisible(worldX, routePathY(worldX), 60)) continue;
    const point = projectWorld(worldX, routePathY(worldX), 0, pathPoint);
    if (!point.ok) continue;
    const scale = point.scale;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(courseDirection > 0 ? 0 : Math.PI);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,224,148,.75)';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// Faint chart line for the navigable corridor so the open ocean still reads as
// a charted passage rather than an invisible wall.
function drawShippingLane() {
  const reach = view.altitude * 2.4 + 800;
  const step = cap(view.altitude * .05, 40, 110);
  ctx.save();
  ctx.setLineDash([6, 22]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(255,231,164,.16)';
  [-COURSE_CENTER, COURSE_CENTER].forEach((worldY) => {
    ctx.beginPath();
    let started = false;
    for (let worldX = camera.x - reach; worldX <= camera.x + reach; worldX += step) {
      const point = projectWorld(worldX, worldY, 0, pathPoint);
      if (!point.ok) { started = false; continue; }
      if (started) ctx.lineTo(point.x, point.y);
      else { ctx.moveTo(point.x, point.y); started = true; }
    }
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.restore();
}

function seededNoise(value) {
  const result = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return result - Math.floor(result);
}

function drawDecorativeIslands(time) {
  const cell = 850;
  const reach = view.altitude * 1.4 + 900;
  const minX = Math.floor((camera.x - reach) / cell);
  const maxX = Math.ceil((camera.x + reach) / cell);
  const minY = Math.floor((camera.y - reach) / cell);
  const maxY = Math.ceil((camera.y + reach) / cell);
  if ((maxX - minX + 1) * (maxY - minY + 1) > 900) return;
  for (let column = minX; column <= maxX; column += 1) {
    for (let row = minY; row <= maxY; row += 1) {
      const seed = seededNoise(column * 17.3 + row * 41.7);
      if (seed < .62) continue;
      const x = column * cell + seededNoise(seed * 91) * 650;
      const y = row * cell + seededNoise(seed * 173) * 650;
      const radius = 24 + seededNoise(seed * 211) * 58;
      if (Math.abs(y - routePathY(x)) < 430 + radius && x > -600 && x < state.outboundDistance + 600) continue;
      if (!isVisible(x, y, radius + 80)) continue;
      drawIsland(x, y, radius, seed);
    }
  }
}

function drawIsland(x, y, radius, seed) {
  ctx.save();
  if (!setPlanFrame(x, y, seed * Math.PI * 2, 1, 3)) { ctx.restore(); return; }
  const fade = distanceFade(x, y);
  ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(3,46,50,.3)';
  ctx.beginPath();
  ctx.ellipse(7, 11, radius * 1.25, radius * .78, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d6955';
  ctx.beginPath();
  ctx.moveTo(-radius, 8);
  ctx.bezierCurveTo(-radius * .55, -radius * .75, radius * .65, -radius * .58, radius, 6);
  ctx.bezierCurveTo(radius * .4, radius * .55, -radius * .45, radius * .52, -radius, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(241,224,174,.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  if (!setPlanFrame(x, y, seed * Math.PI * 2, 1, 3)) { ctx.restore(); return; }
  ctx.globalAlpha = fade * .8;
  ctx.fillStyle = 'rgba(28,58,46,.85)';
  ctx.beginPath();
  ctx.ellipse(-radius * .18, -radius * .05, radius * .46, radius * .34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(52,94,72,.9)';
  ctx.beginPath();
  ctx.ellipse(radius * .2, -radius * .1, radius * .3, radius * .22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCoastLand(x, y, side, extent, depth) {
  const coastOffset = PORT_LAND_RADIUS * .72;
  ctx.save();
  if (!setPlanFrame(x, y, side > 0 ? 0 : Math.PI, 1, 2)) { ctx.restore(); return; }
  const landGradient = ctx.createLinearGradient(coastOffset, 0, coastOffset + depth, 0);
  landGradient.addColorStop(0, '#4c7459');
  landGradient.addColorStop(1, '#2f5549');
  ctx.fillStyle = landGradient;
  ctx.beginPath();
  ctx.moveTo(coastOffset, -extent);
  ctx.bezierCurveTo(coastOffset + 34, -extent * .62, coastOffset - 38, -extent * .28, coastOffset + 12, 0);
  ctx.bezierCurveTo(coastOffset - 30, extent * .3, coastOffset + 42, extent * .64, coastOffset - 6, extent);
  ctx.lineTo(depth, extent);
  ctx.lineTo(depth, -extent);
  ctx.closePath();
  ctx.fill();
  // Sand fringe just inland of the surf line, so the coast reads as a beach from
  // the high angle instead of a flat wash meeting the water.
  const c = coastOffset;
  const e = extent;
  const band = 40;
  ctx.fillStyle = 'rgba(228,206,158,.42)';
  ctx.beginPath();
  ctx.moveTo(c, -e);
  ctx.bezierCurveTo(c + 34, -e * .62, c - 38, -e * .28, c + 12, 0);
  ctx.bezierCurveTo(c - 30, e * .3, c + 42, e * .64, c - 6, e);
  ctx.lineTo(c - 6 + band, e);
  ctx.bezierCurveTo(c + 42 + band, e * .64, c - 30 + band, e * .3, c + 12 + band, 0);
  ctx.bezierCurveTo(c - 38 + band, -e * .28, c + 34 + band, -e * .62, c + band, -e);
  ctx.closePath();
  ctx.fill();
  // Inland relief: broad hollows and rises, deterministic so they never crawl.
  ctx.fillStyle = 'rgba(40,76,60,.5)';
  for (let index = 0; index < 4; index += 1) {
    const patchX = coastOffset + 150 + index * 300;
    const patchY = -extent * .34 + (index % 2 ? 1 : -1) * extent * .24;
    ctx.beginPath();
    ctx.ellipse(patchX, patchY, 195, 98, (index % 2 ? .16 : -.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(70,114,86,.46)';
  for (let index = 0; index < 3; index += 1) {
    const patchX = coastOffset + 300 + index * 400;
    const patchY = -extent * .12 + (index % 2 ? -1 : 1) * extent * .3;
    ctx.beginPath();
    ctx.ellipse(patchX, patchY, 132, 68, (index % 2 ? -.12 : .12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(244,228,180,.72)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(coastOffset, -extent);
  ctx.bezierCurveTo(coastOffset + 34, -extent * .62, coastOffset - 38, -extent * .28, coastOffset + 12, 0);
  ctx.bezierCurveTo(coastOffset - 30, extent * .3, coastOffset + 42, extent * .64, coastOffset - 6, extent);
  ctx.stroke();
  // Hills: a shaded footprint with the sunlit slope lifted up-screen, the same
  // 2.5D convention the warehouse roofs use, so they read as height overhead.
  for (let index = 0; index < 5; index += 1) {
    const mountainX = coastOffset + 170 + index * 245;
    const mountainY = -extent * .42 + index * extent * .2;
    ctx.fillStyle = 'rgba(28,58,46,.5)';
    ctx.beginPath();
    ctx.moveTo(mountainX - 108, mountainY + 92);
    ctx.lineTo(mountainX + 4, mountainY - 70);
    ctx.lineTo(mountainX + 124, mountainY + 92);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(68,112,82,.6)';
    ctx.beginPath();
    ctx.moveTo(mountainX - 95, mountainY + 28);
    ctx.lineTo(mountainX, mountainY - 147);
    ctx.lineTo(mountainX + 110, mountainY + 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(92,138,102,.5)';
    ctx.beginPath();
    ctx.moveTo(mountainX - 95, mountainY + 28);
    ctx.lineTo(mountainX, mountainY - 147);
    ctx.lineTo(mountainX + 8, mountainY + 28);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPort(x, y, name, subtitle, side, time) {
  // Coast geometry grows with the view so the shoreline always runs off-frame.
  const extent = Math.max(1150, view.altitude * 1.5);
  const depth = Math.max(1900, view.altitude * 2.1);
  drawCoastLand(x, y, side, extent, depth);
  const fade = distanceFade(x, y);
  const point = projectWorld(x, y, 2, framePoint);
  ctx.save();
  if (point.ok) {
    setPlanFrame(x, y, side > 0 ? 0 : Math.PI, 1, 2);
    ctx.globalAlpha = fade;
    const coast = PORT_LAND_RADIUS * .72;
  ctx.strokeStyle = 'rgba(94,64,38,.72)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(coast + 35, -150);
  ctx.lineTo(coast + 260, -150);
  ctx.moveTo(coast + 35, 145);
  ctx.lineTo(coast + 250, 145);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (let plank = -140; plank <= 140; plank += 28) {
    ctx.beginPath();
    ctx.moveTo(coast + 45, plank);
    ctx.lineTo(coast + 245, plank);
    ctx.stroke();
  }
  for (let index = 0; index < 4; index += 1) {
    const warehouseX = coast + 360 + (index % 2) * 230;
    const warehouseY = -260 + Math.floor(index / 2) * 420;
    ctx.fillStyle = index % 2 ? '#b79a6b' : '#a88a5f';
    ctx.fillRect(warehouseX, warehouseY, 190, 120);
    ctx.fillStyle = 'rgba(72,52,35,.6)';
    ctx.beginPath();
    ctx.moveTo(warehouseX - 12, warehouseY);
    ctx.lineTo(warehouseX + 95, warehouseY - 52);
    ctx.lineTo(warehouseX + 202, warehouseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(64,42,28,.5)';
    ctx.fillRect(warehouseX + 66, warehouseY + 56, 58, 64);
    ctx.strokeStyle = 'rgba(63,44,30,.45)';
    ctx.lineWidth = 1;
    for (let seam = 20; seam < 190; seam += 28) {
      ctx.beginPath();
      ctx.moveTo(warehouseX + seam, warehouseY + 8);
      ctx.lineTo(warehouseX + seam, warehouseY + 112);
      ctx.stroke();
    }
  }
  for (let index = 0; index < 3; index += 1) {
    const flagX = coast + 285 + index * 245;
    const flagY = index % 2 ? 220 : -205;
    ctx.strokeStyle = '#4a3524';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.lineTo(flagX, flagY + 95);
    ctx.stroke();
    const flutter = Math.sin(time * .006 + index) * 8;
    ctx.fillStyle = index === 1 ? '#2f6f77' : '#a9553f';
    ctx.beginPath();
    ctx.moveTo(flagX, flagY + 2);
    ctx.quadraticCurveTo(flagX + 28, flagY + 9 + flutter, flagX + 56, flagY + 4);
    ctx.lineTo(flagX + 50, flagY + 28);
    ctx.quadraticCurveTo(flagX + 24, flagY + 24 - flutter, flagX, flagY + 30);
    ctx.closePath();
    ctx.fill();
  }
  for (let index = 0; index < 4; index += 1) {
    const palmX = coast + 700 + index * 145;
    const palmY = -520 + index * 330;
    ctx.strokeStyle = '#5b4329';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(palmX, palmY);
    ctx.quadraticCurveTo(palmX - 10, palmY - 38, palmX + 8, palmY - 66);
    ctx.stroke();
    ctx.strokeStyle = '#315f45';
    ctx.lineWidth = 9;
    for (let frond = 0; frond < 6; frond += 1) {
      const angle = frond * Math.PI / 3 + Math.sin(time * .001 + index) * .05;
      ctx.beginPath();
      ctx.moveTo(palmX + 8, palmY - 66);
      ctx.quadraticCurveTo(palmX + 8 + Math.cos(angle) * 32, palmY - 66 + Math.sin(angle) * 20, palmX + 8 + Math.cos(angle) * 55, palmY - 66 + Math.sin(angle) * 34);
      ctx.stroke();
    }
  }
  for (let index = 0; index < 7; index += 1) {
    const figureX = coast + 150 + (index % 4) * 72;
    const figureY = (index < 4 ? -1 : 1) * (170 + Math.sin(time * .0016 + index) * 10);
    ctx.fillStyle = index % 2 ? 'rgba(72,50,36,.78)' : 'rgba(126,74,45,.8)';
    ctx.beginPath();
    ctx.arc(figureX, figureY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(figureX - 6, figureY + 7, 12, 22);
  }
  ctx.restore();
  }

  // Harbour marker: anchor ring on the water, name plate kept horizontal on
  // screen so it stays readable at any camera yaw.
  ctx.save();
  if (!setPlanFrame(x, y, 0, 1, 1)) { ctx.restore(); return; }
  ctx.globalAlpha = fade;
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = 'rgba(255,227,154,.62)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, PORT_ARRIVAL_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const label = projectWorld(x, y, 1, framePoint);
  if (!label.ok) return;
  const labelY = label.y - PORT_ARRIVAL_RADIUS * label.scale - 14;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(4,26,36,.6)';
  ctx.fillRect(label.x - 74, labelY - 24, 148, 32);
  ctx.fillStyle = '#fff1c7';
  ctx.font = '700 13px Manrope, sans-serif';
  ctx.fillText(name, label.x, labelY - 10);
  ctx.fillStyle = '#c2e0d4';
  ctx.font = '10px DM Mono, monospace';
  ctx.fillText(subtitle, label.x, labelY + 3);
  ctx.restore();
}

function drawObstacle(obstacle, time) {
  if (!isVisible(obstacle.x, obstacle.y, obstacle.r + 90)) return;
  const fade = distanceFade(obstacle.x, obstacle.y);
  if (fade <= .02) return;
  const point = projectWorld(obstacle.x, obstacle.y, 0, projection);
  if (!point.ok) return;
  ctx.save();
  if (!setPlanFrame(obstacle.x, obstacle.y, obstacle.type === 'wreck' || obstacle.type === 'whirlpool' || obstacle.type === 'breaker' ? 0 : obstacle.rotation, 1, 0)) { ctx.restore(); return; }
  ctx.globalAlpha = fade;
  if (obstacle.type === 'whirlpool') {
    ctx.strokeStyle = 'rgba(200,248,244,.5)';
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 4; ring += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, obstacle.r * (.28 + ring * .2), time * .001 * (ring % 2 ? -1 : 1) + ring, time * .001 * (ring % 2 ? -1 : 1) + ring + 4.4);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(6,48,64,.45)';
    ctx.beginPath();
    ctx.arc(0, 0, obstacle.r * .2, 0, Math.PI * 2);
    ctx.fill();
  } else if (obstacle.type === 'breaker') {
    ctx.strokeStyle = 'rgba(220,252,246,.78)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, obstacle.r * 1.4, Math.PI * .1, Math.PI * 1.1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,240,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, obstacle.r * 1.1, Math.PI * .2, Math.PI * .95);
    ctx.stroke();
  } else if (obstacle.type === 'wreck') {
    ctx.rotate(-.28);
    ctx.fillStyle = 'rgba(3,26,32,.35)';
    ctx.beginPath();
    ctx.ellipse(7, 12, obstacle.r * 1.3, obstacle.r * .5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b3a2a';
    ctx.beginPath();
    ctx.moveTo(obstacle.r * 1.2, 0);
    ctx.quadraticCurveTo(0, -obstacle.r * .45, -obstacle.r * 1.2, -obstacle.r * .2);
    ctx.lineTo(-obstacle.r, obstacle.r * .3);
    ctx.quadraticCurveTo(0, obstacle.r * .55, obstacle.r * 1.2, 0);
    ctx.fill();
    ctx.strokeStyle = '#c9a76a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-obstacle.r * .2, -obstacle.r * .15);
    ctx.lineTo(-obstacle.r * .1, -obstacle.r * 1.05);
    ctx.moveTo(-obstacle.r * .1, -obstacle.r * .7);
    ctx.lineTo(obstacle.r * .55, -obstacle.r * .35);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(25,20,18,.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(obstacle.r * .3, -obstacle.r * .1);
    ctx.lineTo(obstacle.r * .05, obstacle.r * .2);
    ctx.lineTo(obstacle.r * .4, obstacle.r * .3);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(0,24,31,.34)';
    ctx.beginPath();
    ctx.ellipse(8, obstacle.r * .54, obstacle.r * 1.15, obstacle.r * .68, 0, 0, Math.PI * 2);
    ctx.fill();
    const rockGradient = ctx.createLinearGradient(-obstacle.r, -obstacle.r, obstacle.r, obstacle.r);
    if (obstacle.type === 'sandbar') {
      rockGradient.addColorStop(0, '#c7ae73');
      rockGradient.addColorStop(1, '#756a49');
    } else if (obstacle.type === 'debris' || obstacle.type === 'wreckage') {
      rockGradient.addColorStop(0, '#9a6a45');
      rockGradient.addColorStop(1, '#4b342b');
    } else {
      rockGradient.addColorStop(0, '#55706d');
      rockGradient.addColorStop(1, '#263f43');
    }
    ctx.fillStyle = rockGradient;
    ctx.beginPath();
    ctx.moveTo(-obstacle.r, obstacle.r * .5);
    ctx.lineTo(-obstacle.r * .72, -obstacle.r * .42);
    ctx.lineTo(-obstacle.r * .18, -obstacle.r * .86);
    ctx.lineTo(obstacle.r * .55, -obstacle.r * .58);
    ctx.lineTo(obstacle.r, obstacle.r * .2);
    ctx.lineTo(obstacle.r * .55, obstacle.r * .7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = obstacle.type === 'sandbar' ? 'rgba(255,233,170,.65)' : 'rgba(181,223,208,.36)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
  // Hazard tag sits flat on the water, sized in screen space so it stays legible
  // at any zoom without turning into a billboard.
  const labelSize = cap(obstacle.r * point.scale * .3, 7, 12);
  ctx.globalAlpha = fade * cap((obstacle.r * point.scale - 6) / 10, 0, 1);
  ctx.fillStyle = 'rgba(255,232,178,.85)';
  ctx.font = `700 ${labelSize.toFixed(1)}px DM Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(obstacle.type.toUpperCase(), point.x, point.y + obstacle.r * point.scale * view.sinT + labelSize + 3);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

function drawShip(time) {
  const ship = state.ship;
  const weather = weatherProfile();
  const sailPower = ship.sail;
  const windStrength = cap(state.wind.strength + weather.severity * .4, 0, 1.8);
  const wakeStrength = cap(ship.wake, 0, 1.4);
  const sailHeight = 27 + sailPower * 42;
  const sailBelly = 7 + windStrength * 12 + Math.sin(time * .005) * 2.5;
  const hullDamage = 1 - state.hull / 100;
  const mastX = -2;
  const mastTop = -14 - sailHeight;
  const heading = ship.heading + ship.rock;
  const deckElevation = ship.bob;
  const mastBase = deckElevation + 5;
  const rigElevation = deckElevation - mastTop * .55;
  const mastHead = deckElevation - mastTop + 8;
  const hullPoint = projectWorld(ship.x, ship.y, deckElevation, shipPoint);
  if (!hullPoint.ok) return;

  // Soft shadow on the water, thrown away from the light bearing.
  ctx.save();
  const lightAngle = screenHeadingAngle(-.9 + dayProgress() * 2.1) + Math.PI;
  ctx.translate(hullPoint.x + Math.cos(lightAngle) * 13 * hullPoint.scale, hullPoint.y + Math.sin(lightAngle) * 13 * hullPoint.scale);
  ctx.fillStyle = 'rgba(1,16,24,.26)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 54 * hullPoint.scale, 20 * hullPoint.scale, lightAngle, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  if (!setPlanFrame(ship.x, ship.y, heading, 1, deckElevation)) { ctx.restore(); return; }
  ctx.transform(1, 0, ship.heel * .16, 1, 0, 0);

  ctx.strokeStyle = `rgba(232,250,244,${.14 + wakeStrength * .34})`;
  ctx.lineCap = 'round';
  for (let wake = 0; wake < 4; wake += 1) {
    const spread = (8 + wake * 6.5) * (1 + wakeStrength * .4);
    const length = (34 + wake * 19) * (.45 + wakeStrength);
    ctx.lineWidth = Math.max(.6, 2.6 - wake * .45);
    ctx.beginPath();
    ctx.moveTo(-22 - wake * 7, -spread * .3);
    ctx.quadraticCurveTo(-length * .62, -spread + Math.sin(time * .006 + wake) * 4, -length, -spread * .8);
    ctx.moveTo(-22 - wake * 7, spread * .3);
    ctx.quadraticCurveTo(-length * .62, spread + Math.sin(time * .006 + wake + 1) * 4, -length, spread * .8);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(236,252,248,${.1 + wakeStrength * .16})`;
  ctx.beginPath();
  ctx.ellipse(-30, 0, 26 + wakeStrength * 12, 12 + wakeStrength * 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(0,18,24,${.24 + wakeStrength * .08})`;
  ctx.beginPath();
  ctx.ellipse(-3, 9, 48, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  const hullGradient = ctx.createLinearGradient(0, -15, 0, 16);
  hullGradient.addColorStop(0, hullDamage > .6 ? '#4a2d26' : '#6b3f2d');
  hullGradient.addColorStop(.52, hullDamage > .45 ? '#3a241f' : '#4a2c21');
  hullGradient.addColorStop(1, '#241812');
  ctx.fillStyle = hullGradient;
  ctx.beginPath();
  ctx.moveTo(42, -1);
  ctx.bezierCurveTo(32, -14, 6, -19, -25, -14);
  ctx.quadraticCurveTo(-40, -10, -44, 0);
  ctx.quadraticCurveTo(-38, 11, -24, 15);
  ctx.bezierCurveTo(6, 19, 32, 13, 42, -1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c69a55';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(31,19,15,.72)';
  ctx.lineWidth = 1.2;
  for (let plank = -8; plank <= 9; plank += 6) {
    ctx.beginPath();
    ctx.moveTo(-36 + Math.abs(plank) * .12, plank);
    ctx.quadraticCurveTo(0, plank + 1.5, 37 - Math.abs(plank) * .1, plank * .45);
    ctx.stroke();
  }

  ctx.fillStyle = '#8a6237';
  ctx.beginPath();
  ctx.ellipse(-1, 0, 31, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d6b476';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const crates = Math.min(6, cargoCount());
  for (let index = 0; index < crates; index += 1) {
    const crateX = -20 + (index % 3) * 14;
    const crateY = index < 3 ? -4.5 : 4.5;
    ctx.fillStyle = index % 2 ? '#9b6b38' : '#7d522d';
    ctx.fillRect(crateX, crateY - 3, 10, 7);
    ctx.strokeStyle = '#d6b476';
    ctx.lineWidth = .8;
    ctx.strokeRect(crateX, crateY - 3, 10, 7);
    ctx.beginPath();
    ctx.moveTo(crateX + 1, crateY - 2);
    ctx.lineTo(crateX + 9, crateY + 3);
    ctx.stroke();
  }

  ctx.strokeStyle = '#3b2a1f';
  ctx.lineWidth = 2;
  for (let rail = -2; rail <= 2; rail += 4) {
    ctx.beginPath();
    ctx.moveTo(-33 + Math.abs(rail) * .1, rail);
    ctx.quadraticCurveTo(0, rail * .82, 34, rail * .28);
    ctx.stroke();
  }

  if (state.hull < 66) {
    ctx.strokeStyle = `rgba(20,12,10,${.5 + hullDamage * .4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, -9);
    ctx.lineTo(6, -2);
    ctx.lineTo(13, 5);
    ctx.moveTo(6, -2);
    ctx.lineTo(-2, -4);
    ctx.stroke();
  }
  if (state.hull < 38) {
    ctx.fillStyle = 'rgba(30,20,18,.5)';
    ctx.beginPath();
    ctx.moveTo(24, -8);
    ctx.lineTo(34, -4);
    ctx.lineTo(28, 2);
    ctx.lineTo(18, -1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ---- Standing rig -------------------------------------------------------
  // The mast is a true vertical in screen space and the sail hangs on a plane
  // above the deck, so the vessel reads as a solid object under a high camera.
  const foot = projectWorld(ship.x + Math.cos(heading) * mastX, ship.y + Math.sin(heading) * mastX, mastBase, shipPoint);
  const head = projectWorld(ship.x + Math.cos(heading) * mastX, ship.y + Math.sin(heading) * mastX, mastHead, rigPoint);
  if (foot.ok && head.ok) {
    ctx.save();
    ctx.strokeStyle = 'rgba(74,51,36,.9)';
    ctx.lineWidth = Math.max(1, 3.4 * hullPoint.scale);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(228,206,160,.7)';
    ctx.lineWidth = Math.max(.5, .9 * hullPoint.scale);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(foot.x + (rigPoint.x - foot.x) * .1, foot.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  if (setPlanFrame(ship.x, ship.y, heading, 1, rigElevation)) {
    ctx.transform(1, 0, ship.heel * .18, 1, 0, 0);
    ctx.strokeStyle = 'rgba(228,206,160,.6)';
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.moveTo(mastX - 1, -mastTop);
    ctx.lineTo(-33, -2);
    ctx.moveTo(mastX - 1, -mastTop);
    ctx.lineTo(30, -2);
    ctx.stroke();
    const yardAngle = -.58 - windStrength * .12;
    ctx.save();
    ctx.translate(mastX, 0);
    ctx.rotate(yardAngle);
    ctx.strokeStyle = '#5a3b26';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-sailPower * 9, 0);
    ctx.lineTo(34 + sailPower * 15, 0);
    ctx.stroke();
    const sailGradient = ctx.createLinearGradient(-8, 0, 34, sailHeight);
    sailGradient.addColorStop(0, weather.darkness > .5 ? '#d8c9a4' : '#f4e6bd');
    sailGradient.addColorStop(1, weather.darkness > .5 ? '#a89168' : '#d9bd7f');
    ctx.fillStyle = sailGradient;
    ctx.beginPath();
    ctx.moveTo(-sailPower * 7, 1);
    ctx.quadraticCurveTo(12, sailBelly + 4, 32 + sailPower * 15, 2);
    ctx.quadraticCurveTo(17, sailHeight * .5, 4, sailHeight * .82);
    ctx.quadraticCurveTo(-5, sailHeight * .45, -sailPower * 7, 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hullDamage > .62 ? 'rgba(66,45,32,.85)' : 'rgba(122,91,52,.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (sailPower < .45) {
      for (let reef = 1; reef <= 2; reef += 1) {
        const reefY = sailHeight * .22 * reef;
        ctx.beginPath();
        ctx.moveTo(-4, reefY);
        ctx.lineTo(26 + sailPower * 10, reefY + 3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();

  // Masthead pennant.
  ctx.save();
  if (setPlanFrame(ship.x, ship.y, heading, 1, mastHead + 6)) {
    ctx.translate(mastX, 0);
    const flagWave = Math.sin(time * .009) * (3 + windStrength * 5);
    ctx.strokeStyle = '#4b3326';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(0, -9);
    ctx.stroke();
    ctx.fillStyle = hullDamage > .5 ? '#9c4a38' : '#d99b32';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.quadraticCurveTo(9, -14 + flagWave, 18, -9 + flagWave * .4);
    ctx.lineTo(15, -3);
    ctx.quadraticCurveTo(7, -1 - flagWave * .3, 0, -1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPirateShip(pirate, time) {
  if (!isVisible(pirate.x, pirate.y, 220)) return;
  const fade = distanceFade(pirate.x, pirate.y);
  if (fade <= .02) return;
  const heading = pirate.heading || 0;
  const elevation = Math.sin(time * .004 + pirate.beat) * 4;
  const chaseGlow = pirate.phase === 'chasing' && Math.hypot(state.ship.x - pirate.x, state.ship.y - pirate.y) < 210;
  const anchor = projectWorld(pirate.x, pirate.y, elevation, shipPoint);
  if (!anchor.ok) return;
  ctx.save();
  if (!setPlanFrame(pirate.x, pirate.y, heading, 1.18, elevation)) { ctx.restore(); return; }
  ctx.globalAlpha = fade;

  ctx.strokeStyle = `rgba(239,250,239,${.22 + Math.min(1, pirate.speed / 250) * .46})`;
  ctx.lineCap = 'round';
  for (let line = 0; line < 3; line += 1) {
    const wakeLength = 58 + line * 28;
    const wakeSpread = 11 + line * 9;
    ctx.lineWidth = 2.4 - line * .5;
    ctx.beginPath();
    ctx.moveTo(-38, -4 - line * 2);
    ctx.quadraticCurveTo(-wakeLength * .55, -wakeSpread + Math.sin(time * .006 + line) * 4, -wakeLength, -wakeSpread * .65);
    ctx.moveTo(-38, 4 + line * 2);
    ctx.quadraticCurveTo(-wakeLength * .55, wakeSpread + Math.sin(time * .006 + line + 1) * 4, -wakeLength, wakeSpread * .65);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(2,15,22,.55)';
  ctx.beginPath();
  ctx.ellipse(-5, 13, 57, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#573927';
  ctx.beginPath();
  ctx.moveTo(56, 0);
  ctx.quadraticCurveTo(43, 22, 12, 23);
  ctx.lineTo(-43, 15);
  ctx.lineTo(-53, 5);
  ctx.lineTo(-48, -15);
  ctx.quadraticCurveTo(7, -25, 56, 0);
  ctx.fill();
  ctx.strokeStyle = chaseGlow ? '#e46b50' : '#d0a766';
  ctx.lineWidth = 2.6;
  ctx.stroke();

  ctx.fillStyle = '#8e6943';
  ctx.beginPath();
  ctx.moveTo(-34, -10);
  ctx.lineTo(31, -12);
  ctx.lineTo(42, 0);
  ctx.lineTo(29, 13);
  ctx.lineTo(-35, 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(234,204,151,.75)';
  ctx.lineWidth = 1.4;
  for (let plank = -23; plank <= 23; plank += 12) {
    ctx.beginPath();
    ctx.moveTo(plank, -10);
    ctx.lineTo(plank + 3, 10);
    ctx.stroke();
  }
  ctx.fillStyle = '#30221a';
  ctx.fillRect(-27, -5, 13, 10);
  ctx.fillRect(-8, -5, 13, 10);
  ctx.fillRect(11, -5, 13, 10);

  ctx.restore();

  // Standing rig, raised clear of the deck.
  const foot = projectWorld(pirate.x - Math.cos(heading) * 2.4, pirate.y - Math.sin(heading) * 2.4, elevation + 6, shipPoint);
  const head = projectWorld(pirate.x - Math.cos(heading) * 2.4, pirate.y - Math.sin(heading) * 2.4, elevation + 66, rigPoint);
  if (foot.ok && head.ok) {
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = 'rgba(51,37,28,.95)';
    ctx.lineWidth = Math.max(1, 4 * anchor.scale);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(183,149,96,.9)';
    ctx.lineWidth = Math.max(.8, 3 * anchor.scale);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y - 18 * anchor.scale);
    ctx.lineTo(foot.x, head.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  if (setPlanFrame(pirate.x, pirate.y, heading, 1.18, elevation + 30)) {
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#b79560';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-29, -23);
    ctx.lineTo(35, -25);
    ctx.stroke();
    ctx.fillStyle = '#191c20';
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.quadraticCurveTo(27, -64, 32, -28);
    ctx.lineTo(4, -25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(202,184,147,.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#101216';
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(-30, -66);
    ctx.lineTo(-5, -27);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  if (setPlanFrame(pirate.x, pirate.y, heading, 1.18, elevation + 58)) {
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#08090b';
    ctx.beginPath();
    ctx.moveTo(-1, -87);
    ctx.quadraticCurveTo(13, -92, 26, -85);
    ctx.lineTo(9, -72);
    ctx.quadraticCurveTo(2, -76, -1, -71);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4e9d2';
    ctx.beginPath();
    ctx.arc(7, -84, 1.6, 0, Math.PI * 2);
    ctx.arc(15, -82, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f4e9d2';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(7, -78);
    ctx.lineTo(16, -76);
    ctx.moveTo(8, -76);
    ctx.lineTo(5, -73);
    ctx.moveTo(14, -75);
    ctx.lineTo(18, -72);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.globalAlpha = fade;
  ctx.fillStyle = chaseGlow ? '#ff8875' : '#ffe2bd';
  ctx.font = '700 11px DM Mono, monospace';
  const label = pirate.phase === 'chasing' ? 'PIRATE DHOW · CHASING' : pirate.phase === 'retreating' ? (pirate.destroyed ? 'PIRATE DHOW · WRECKED' : 'PIRATE DHOW · RETREATING') : 'PIRATE DHOW';
  ctx.fillText(label, anchor.x, anchor.y + 60 * anchor.scale * view.sinT + 12);
  if (pirate.health < PIRATE_MAX_HEALTH) {
    const ratio = cap(pirate.health / PIRATE_MAX_HEALTH, 0, 1);
    const barWidth = 58 * anchor.scale;
    ctx.fillStyle = 'rgba(6,14,20,.72)';
    ctx.fillRect(anchor.x - barWidth / 2, anchor.y + 60 * anchor.scale * view.sinT + 18, barWidth, 6);
    ctx.fillStyle = ratio > .55 ? '#8fd6a2' : ratio > .25 ? '#f2c14e' : '#e46b50';
    ctx.fillRect(anchor.x - barWidth / 2 + 1, anchor.y + 60 * anchor.scale * view.sinT + 19, (barWidth - 2) * ratio, 4);
  }
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// Wind streaks ride the water surface: they are anchored in world space and
// projected, so they stretch correctly with the swell instead of sliding over it.
function drawWindField(time, weather) {
  const angle = state.wind.angle;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const screenAngle = screenHeadingAngle(angle);
  const cellForward = 240;
  const cellCross = 300;
  const drift = time * (.00009 * state.wind.strength * (.7 + weather.windSpeed)) * 260;
  const firstForward = Math.floor((view.fwdMin - cellForward) / cellForward);
  const lastForward = Math.ceil((view.fwdMax + cellForward) / cellForward);
  ctx.save();
  ctx.lineCap = 'round';
  for (let row = firstForward; row <= lastForward; row += 1) {
    const forwardBase = row * cellForward;
    const half = crossHalfAt(forwardBase) + cellCross;
    const firstCross = Math.floor((-half - cellCross) / cellCross);
    const lastCross = Math.ceil((half + cellCross) / cellCross);
    for (let column = firstCross; column <= lastCross; column += 1) {
      const seed = seededNoise(row * 9.1 + column * 3.7);
      if (seed < .35) continue;
      const travel = (seed * 900 + drift) % cellForward;
      const forward = forwardBase + travel;
      const lateral = column * cellCross + seededNoise(seed * 47) * cellCross + travel * .12;
      const point = projectForwardLateral(forward, lateral, pathPoint);
      if (!point.ok) continue;
      const length = (16 + (row + column) % 4 * 7) * (.7 + weather.windSpeed * .55) * point.scale;
      if (length < 2) continue;
      ctx.strokeStyle = `rgba(210,246,255,${.09 + (row + column) % 3 * .03 + weather.severity * .07})`;
      ctx.lineWidth = cap(1.1 + weather.severity * .8, .5, 2.4);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - Math.cos(screenAngle) * length, point.y - Math.sin(screenAngle) * length);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Reads the on-screen HUD boxes once per resize so canvas-drawn furniture can
// dodge them. The HUD itself is untouched; this only tells the renderer where
// the free corners are.
const HUD_SELECTORS = ['.sailing-hud', '.objective-card', '.control-hint', '.pirate-hud', '.developer-tools', '.pirate-warning', '.storm-warning'];

function refreshHudBoxes() {
  const stage = canvas.getBoundingClientRect();
  hudBoxes = HUD_SELECTORS.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { left: rect.left - stage.left, top: rect.top - stage.top, right: rect.right - stage.left, bottom: rect.bottom - stage.top };
  }).filter(Boolean);
  hudBoxAge = 0;
}

function boxBlocks(x, y, radius) {
  if (!hudBoxes) return false;
  return hudBoxes.some((box) => x + radius > box.left && x - radius < box.right && y + radius > box.top && y - radius < box.bottom);
}

function freeCorner(x, y, radius) {
  return x > radius + 6 && x < view.width - radius - 6 && y > radius + 6 && y < view.height - radius - 6 && !boxBlocks(x, y, radius);
}

// Compass rose parked in the first corner the HUD leaves free.
function compassSpot(radius) {
  hudBoxAge += 1;
  if (!hudBoxes || hudBoxAge > 30) refreshHudBoxes();
  const candidates = [
    [view.width - radius - 28, view.height - radius - 28],
    [view.width - radius - 28, view.height * .52],
    [view.width * .5, view.height - radius - 28],
    [radius + 28, view.height - radius - 28],
    [view.width - radius - 28, radius + 120],
  ];
  for (const [x, y] of candidates) if (freeCorner(x, y, radius)) return { x, y };
  return { x: view.width - radius - 28, y: view.height - radius - 28 };
}

// Compass rose pinned to a free corner of the ocean area, with the ring rotated
// to match the chart underneath the camera.
function drawCompass(x, y) {
  const radius = 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(2,39,51,.74)';
  ctx.strokeStyle = 'rgba(240,230,190,.42)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f5e7bd';
  ctx.font = '700 9px DM Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cardinals = [[-Math.PI / 2, 'N'], [0, 'E'], [Math.PI / 2, 'S'], [Math.PI, 'W']];
  cardinals.forEach(([bearing, letter]) => {
    const angle = screenHeadingAngle(bearing);
    ctx.fillText(letter, Math.cos(angle) * (radius - 11), Math.sin(angle) * (radius - 11) * view.sinT);
  });
  drawCompassPointer(screenHeadingAngle(state.ship.heading), '#f0bd50', 26, 7);
  drawCompassPointer(screenHeadingAngle(state.wind.angle), '#80d9ef', 20, 5);
  ctx.fillStyle = '#9fd5df';
  ctx.font = '700 8px DM Mono, monospace';
  ctx.fillText('WIND', 0, radius + 14);
  ctx.restore();
}

function drawCompassPointer(angle, color, length, halfWidth) {
  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(length, 0);
  ctx.lineTo(-3, -halfWidth);
  ctx.lineTo(3, 0);
  ctx.lineTo(-3, halfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStormOverlay(time, width, height) {
  if (!state.stormActive) return;
  const intensity = state.stormIntensity;
  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, `rgba(15,22,38,${.2 + intensity * .3})`);
  shade.addColorStop(.55, 'rgba(20,39,53,.06)');
  shade.addColorStop(1, `rgba(6,22,34,${.2 + intensity * .24})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  // Squall cells darken the water they pass over instead of hanging in a sky.
  for (let index = 0; index < 6; index += 1) {
    const forward = view.fwdMin + ((time * (.02 + intensity * .03) + index * 431) % (view.fwdMax - view.fwdMin));
    const lateral = (seededNoise(index * 5.3) - .5) * crossHalfAt(forward) * 1.4;
    const point = projectForwardLateral(forward, lateral, pathPoint);
    if (!point.ok) continue;
    const radius = (300 + index % 3 * 190) * point.scale;
    if (radius < 6) continue;
    const cell = ctx.createRadialGradient(point.x, point.y, 1, point.x, point.y, radius);
    cell.addColorStop(0, `rgba(23,31,46,${.2 + intensity * .24})`);
    cell.addColorStop(1, 'rgba(23,31,46,0)');
    ctx.fillStyle = cell;
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, radius, radius * view.sinT, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = `rgba(207,235,245,${.24 + intensity * .22})`;
  ctx.lineWidth = 1.3;
  for (let index = 0; index < 70; index += 1) {
    const x = (index * 97 + time * .31) % (width + 100) - 50;
    const y = (index * 53 + time * .46) % height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 15 - intensity * 8, y + 25);
    ctx.stroke();
  }
}

function drawEarthquakeOverlay(time, width, height) {
  if (state.earthquake <= 0) return;
  const intensity = state.quakePower;
  ctx.save();
  ctx.strokeStyle = `rgba(255,209,110,${.16 + intensity * .2})`;
  ctx.lineWidth = 2;
  for (let line = 0; line < 6; line += 1) {
    const baseY = height * (.12 + line * .16);
    ctx.beginPath();
    for (let x = -30; x <= width + 30; x += 45) {
      const faultY = baseY + Math.sin(x * .012 + time * .009 + line) * (18 + intensity * 26);
      if (x === -30) ctx.moveTo(x, faultY);
      else ctx.lineTo(x, faultY);
    }
    ctx.stroke();
  }
  for (let index = 0; index < 22; index += 1) {
    const x = (index * 137 + Math.sin(time * .002 + index) * 60) % width;
    const y = (index * 83 + time * .035 * (index % 2 ? 1 : -1) + height * 4) % height;
    ctx.fillStyle = `rgba(196,225,214,${.05 + (index % 4) * .025})`;
    ctx.beginPath();
    ctx.arc(x, y, 16 + index % 5 * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const shade = ctx.createRadialGradient(width / 2, height / 2, height * .2, width / 2, height / 2, width * .72);
  shade.addColorStop(0, 'rgba(60,40,20,0)');
  shade.addColorStop(1, `rgba(60,36,18,${.12 + intensity * .18})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawTsunamiOverlay(time, width, height) {
  if (state.tsunami <= 0) return;
  const intensity = state.tsunamiPower;
  const travel = (time * .00022 * (.7 + intensity) + width * .45) % (width + 640);
  const baseX = courseDirection > 0 ? width + 180 - travel : -180 + travel;
  ctx.save();
  for (let layer = 0; layer < 3; layer += 1) {
    const x = baseX - courseDirection * layer * 78;
    const offset = Math.sin(time * .006 + layer) * 18;
    ctx.fillStyle = `rgba(48,157,196,${.12 + intensity * .11 - layer * .02})`;
    ctx.beginPath();
    ctx.moveTo(x + 105, -50);
    ctx.bezierCurveTo(x - 35 + offset, height * .2, x + 95, height * .48, x - 55 + offset, height + 50);
    ctx.lineTo(x + 125, height + 50);
    ctx.bezierCurveTo(x + 205, height * .55, x + 55, height * .25, x + 195, -50);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(222,250,255,${.32 + intensity * .28})`;
    ctx.lineWidth = 4 - layer;
    ctx.beginPath();
    ctx.moveTo(x + 105, -30);
    ctx.bezierCurveTo(x - 35 + offset, height * .2, x + 95, height * .48, x - 55 + offset, height + 30);
    ctx.stroke();
  }
  ctx.restore();
}

// The typhoon reads as a whirl spinning on the sea surface ahead of the ship.
function drawTyphoonOverlay(time, width, height) {
  if (state.typhoon <= 0) return;
  const intensity = state.typhoonPower;
  const forward = view.fwdMin + (view.fwdMax - view.fwdMin) * .58;
  const point = projectForwardLateral(forward, (courseDirection > 0 ? .3 : -.3) * crossHalfAt(forward), pathPoint);
  if (point.ok) {
    const unit = Math.max(6, 120 * point.scale);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(time * .0016 * (courseDirection > 0 ? 1 : -1));
    for (let arm = 0; arm < 5; arm += 1) {
      ctx.rotate(Math.PI * 2 / 5);
      ctx.strokeStyle = `rgba(38,48,64,${.2 + intensity * .2})`;
      ctx.lineWidth = (26 + arm * 3) * point.scale;
      ctx.beginPath();
      ctx.ellipse(0, 0, unit * (.78 + arm * .31), unit * (.78 + arm * .31) * view.sinT, 0, .2, Math.PI * 1.28);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(30,39,54,${.3 + intensity * .24})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, unit * .52, unit * .52 * view.sinT, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = `rgba(214,240,250,${.2 + intensity * .2})`;
  ctx.lineWidth = 1.5;
  for (let index = 0; index < 85; index += 1) {
    const x = (index * 113 + time * (.5 + intensity * .2)) % (width + 120) - 60;
    const y = (index * 61 + time * .78) % height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 26 - intensity * 12, y + 34);
    ctx.stroke();
  }
}

function loop(time) {
  const dt = Math.min((time - lastTime) / 1000 || 0, .05);
  lastTime = time;
  if (state.started && !state.finished) state.totalJourneyTime += dt;
  updateParticles(dt);
  state.lightningFlash = Math.max(0, state.lightningFlash - dt * 3.6);
  updatePirateDecisionDeadline(time);
  updateShip(dt);
  updateCamera(dt);
  drawOcean(time);
  updateHud();
  requestAnimationFrame(loop);
}

function updatePirateDecisionDeadline(time) {
  if (state.pendingEvent?.type !== 'pirates' || !state.pirateDecisionDeadline) return;
  const secondsLeft = Math.max(0, Math.ceil((state.pirateDecisionDeadline - time) / 1000));
  $('pirateCountdown').textContent = secondsLeft ? `Choose within ${secondsLeft}s · chase lasts ${PIRATE_CHASE_DURATION} seconds` : 'Time is up · the crew runs';
  if (secondsLeft === 0) resolveEncounter({ label: 'Run away', note: 'The choice window closed; the crew ran for it.', effect: { response: 'bad' } });
}

function resetGame() {
  state = initialState();
  state.level = 5;
  state.outboundDistance = calculateOutboundDistance();
  state.routeReferenceDistance = state.outboundDistance;
  state.calicutX = state.outboundDistance;
  state.legDistanceTotal = Math.max(1, state.outboundDistance - SHIP_START_OFFSET - PORT_ARRIVAL_RADIUS);
  state.legDistanceTravelled = 0;
  particles = [];
  keys = {};
  state.ship.sail = .62;
  resizeCanvas();
  prepareObstacleCourse(1);
  modal('endingBackdrop', false);
  modal('marketBackdrop', false);
  modal('modalBackdrop', false);
  modal('logBackdrop', false);
  modal('presentationBackdrop', false);
  modal('howToBackdrop', false);
  modal('introBackdrop', false);
  modal('startBackdrop', true);
  $('stormWarning').classList.remove('show');
  $('pirateWarning').classList.remove('show');
  $('lessonCard')?.classList.remove('show');
  state.voyageStart = snapshotVoyage();
  setObjective('Level 5: meet the harbor master in Kilwa.', 'Prepare the ship, survive the crossing, trade in Calicut, then sail west to Kilwa.');
  updateHud();
}

function renderLog() {
  const box = $('logEntries');
  box.innerHTML = '';
  if (!state.log.length) box.innerHTML = '<p class="empty-log">Your decisions will be recorded here.</p>';
  else state.log.forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'log-entry';
    item.innerHTML = `<p>Decision ${entry.number} · ${entry.skill}</p><h3>${entry.title}: ${entry.choice}</h3><div>${entry.note}</div>`;
    box.appendChild(item);
  });
  $('skillsUsed').textContent = state.skills.size ? [...state.skills].join(' · ') : 'Not yet recorded';
}

// ---------------------------------------------------------------------------
// Developer console (test harness). Every command is inert while the voyage is
// not sailing and can be hidden entirely for presentation with one class.
// ---------------------------------------------------------------------------

function devLog(line) {
  state.devHistory.push(line);
  if (state.devHistory.length > 8) state.devHistory.shift();
}

// Test-only helm used to verify long passages. It looks at the same obstacle
// field the player can see and steers for the clearest lane ahead, so a replay
// can reach the far port without a human hand on the rudder. It is only
// reachable from the Developer Console and never runs during normal play.
function autoHelmTick() {
  const ship = state.ship;
  const lookAhead = 1450;
  const corridor = 1180;
  const ahead = courseDirection > 0 ? 1 : -1;
  const nearby = obstacles.filter((obstacle) => {
    const dx = (obstacle.x - ship.x) * ahead;
    return dx > -80 && dx < lookAhead;
  });
  let bestScore = -Infinity;
  let bestHeading = state.returnStarted ? Math.PI : 0;
  let bestClearance = 0;
  for (let offset = -corridor; offset <= corridor; offset += 90) {
    let score = 0;
    let clearance = 700;
    for (const obstacle of nearby) {
      const dx = (obstacle.x - ship.x) * ahead;
      const dy = (obstacle.y + offset) - ship.y;
      const gap = Math.hypot(dx, dy) - obstacle.r - 26;
      if (dx < 420) clearance = Math.min(clearance, gap);
      score += Math.min(gap, 700) * (dx < 420 ? 3 : 1);
    }
    // Prefer a line that also keeps the ship near the charted course.
    const centre = routePathY(ship.x + ahead * 700) + offset;
    score -= Math.abs(centre - ship.y) * .5;
    if (score > bestScore) {
      bestScore = score;
      bestClearance = clearance;
      const targetX = ship.x + ahead * 620;
      const targetY = routePathY(targetX) + offset;
      bestHeading = Math.atan2(targetY - ship.y, targetX - ship.x);
    }
  }
  // Never point the helm so far off the rhumb line that the ship stops making
  // ground: a dodging line has to still be a sailing line.
  const courseHeading = state.returnStarted ? Math.PI : 0;
  const off = Math.atan2(Math.sin(bestHeading - courseHeading), Math.cos(bestHeading - courseHeading));
  bestHeading = courseHeading + Math.max(-.6, Math.min(.6, off));
  state.desiredHeading = bestHeading;
  // Ease off when the water ahead is genuinely poor, so a poor line costs time
  // rather than the hull.
  if (bestClearance < 60 && ship.sail > .6) ship.sail = Math.max(.6, ship.sail - .4);
  else if (ship.sail < .95) ship.sail = Math.min(1, ship.sail + .35);
}

const devCommands = {
  spawnPirate: {
    label: 'SPAWN PIRATE',
    run: () => {
      const spawned = spawnPirate({ type: 'pirates', power: 1.1, debug: true }, 1.1);
      return spawned ? 'pirate dhow closing' : 'pirate already active';
    },
  },
  triggerStorm: {
    label: 'TRIGGER STORM',
    run: () => { beginStormEncounter(1.1); return 'storm front raised'; },
  },
  triggerRock: {
    label: 'TRIGGER ROCK',
    run: () => {
      const ship = state.ship;
      addObstacle({ x: ship.x + 120, y: ship.y, r: 26, type: 'rock' });
      state.hitCooldown = 0;
      state.crisisCooldown = 0;
      return 'reef rock placed ahead';
    },
  },
  triggerFog: {
    label: 'TRIGGER FOG',
    run: () => {
      state.extraFog = .85;
      state.fogTimeLeft = 26;
      journalAdd('technology', 'Fog tested: compass, astrolabe, and sounding lines mattered most.');
      return 'sea fog rolled in';
    },
  },
  triggerCultural: {
    label: 'TRIGGER CULTURAL EVENT',
    run: () => {
      state.chain = 'calicut';
      advanceChain('calicut', 1);
      return 'cultural exchange raised at the port';
    },
  },
  setHull: {
    label: 'SET HULL 50%',
    run: () => { state.hull = 50; updateHud(); return 'hull set to 50%'; },
  },
  setSupplies: {
    label: 'SET SUPPLIES 20',
    run: () => { state.supplies = 20; updateHud(); return 'supplies set to 20'; },
  },
  setCoins: {
    label: 'SET COINS 500',
    run: () => { state.money = 500; updateHud(); return 'coins set to 500'; },
  },
  setCargo: {
    label: 'SET CARGO FULL',
    run: () => { state.cargo = ['ivory', 'ivory', 'spices', 'spices', 'cloth', 'ceramic']; updateMarket(); updateHud(); return 'hold filled to 6 spaces'; },
  },
  autoHelm: {
    label: 'AUTO-HELM (TEST)',
    run: () => {
      state.autoHelm = !state.autoHelm;
      if (!state.autoHelm) state.desiredHeading = null;
      return state.autoHelm ? 'auto-helm engaged: steering for the clearest lane' : 'auto-helm off';
    },
  },
  skipToPort: {
    label: 'SKIP TO PORT',
    run: () => {
      // Moves the ship to the edge of the arrival radius so the Calicut, market
      // and return phases can be tested without sailing the whole crossing.
      const target = state.returnStarted
        ? 60
        : destinationPort().x - 60;
      state.ship.x = target;
      state.ship.y = 0;
      state.legDistanceTravelled = Math.max(0, target - state.legStartX);
      state.desiredHeading = state.returnStarted ? Math.PI : 0;
      updateHud();
      return state.returnStarted ? 'placed near Kilwa' : 'placed off the Calicut coast';
    },
  },
};

function wireDevConsole() {
  const host = $('developerConsole');
  if (!host) return;
  host.querySelectorAll('[data-dev]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = devCommands[button.dataset.dev];
      if (!command) return;
      if (!state.started || state.finished || (state.phase !== 'sail-out' && state.phase !== 'sail-return' && !button.dataset.dev.startsWith('set'))) {
        devLog(`${command.label}: start sailing first`);
        return;
      }
      devLog(`${command.label} → ${command.run()}`);
    });
  });
}

function playTransition(kind, done) {
  const overlay = $('sceneTransition');
  if (!overlay) { done(); return; }
  overlay.className = `scene-transition ${kind}-transition is-active`;
  window.setTimeout(() => {
    overlay.className = 'scene-transition';
    done();
  }, 520);
}

function animateCoinDelta(amount) {
  if (!amount) return;
  const badge = $('marketMoney');
  if (!badge) return;
  const floating = document.createElement('span');
  floating.className = `coin-delta ${amount > 0 ? 'gain' : 'loss'}`;
  floating.textContent = `${amount > 0 ? '+' : ''}${amount} coins`;
  badge.appendChild(floating);
  window.setTimeout(() => floating.remove(), 1100);
}

$('startButton').addEventListener('click', () => {
  state.started = true;
  modal('startBackdrop', false);
  emitSound(320);
  if ($('introBackdrop')) modal('introBackdrop', true);
  else advanceChain('pre', 0);
});
$('introContinueButton')?.addEventListener('click', () => { modal('introBackdrop', false); playTransition('decision', () => advanceChain('pre', 0)); });
$('introSkipButton')?.addEventListener('click', () => { modal('introBackdrop', false); advanceChain('pre', 0); });
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => modal(button.dataset.open, true)));
$('restartButton').addEventListener('click', resetGame);
$('resumeButton')?.addEventListener('click', resumeVoyage);
$('playAgainButton').addEventListener('click', resetGame);
$('muteButton').addEventListener('click', () => { state.muted = !state.muted; $('muteButton').textContent = state.muted ? '×' : '♪'; $('muteButton').setAttribute('aria-label', state.muted ? 'Unmute sound' : 'Mute sound'); });
$('logButton').addEventListener('click', () => { renderJournal(); renderLog(); modal('logBackdrop', true); });
$('endingLogButton').addEventListener('click', () => { renderLog(); modal('logBackdrop', true); });
$('presentationButton').addEventListener('click', () => modal('presentationBackdrop', true));
$('endingLogButton').addEventListener('click', () => { modal('endingBackdrop', false); renderJournal(); renderLog(); modal('logBackdrop', true); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.close === 'modalBackdrop' && state.pausedByDecision) {
    toast('Choose a response to continue the voyage.', true);
    return;
  }
  modal(button.dataset.close, false);
  syncPauseIndicator();
}));
$('mapClose').addEventListener('click', () => $('mapPanel').classList.remove('open'));
$('leaveMarketButton').addEventListener('click', () => { modal('marketBackdrop', false); setTimeout(() => advanceChain('calicut', 1), 350); });

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) event.preventDefault();
  keys[key] = true;
  if (key === 'p' && !state.pausedByDecision && state.started && !state.finished && (state.phase === 'sail-out' || state.phase === 'sail-return')) {
    if (state.pirate?.phase === 'chasing') toast('Keep sailing. The pirate chase cannot be paused.', true);
    else {
      state.paused = !state.paused;
      syncPauseIndicator();
      toast(state.paused ? 'Voyage paused.' : 'Voyage resumed.');
    }
  }
  if (key === 'm') $('mapPanel').classList.toggle('open');
  if (key === 'j') { renderJournal(); renderLog(); modal('logBackdrop', true); }
  if (key === 'e' && state.phase === 'market') modal('marketBackdrop', true);
  if (key === '=' || key === '+') camera.zoomTarget = cap(camera.zoomTarget * 1.12, VIEW.minZoom, VIEW.maxZoom);
  if (key === '-' || key === '_') camera.zoomTarget = cap(camera.zoomTarget / 1.12, VIEW.minZoom, VIEW.maxZoom);
});
window.addEventListener('keyup', (event) => { keys[event.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { keys = {}; });
window.addEventListener('resize', resizeCanvas);

canvas.addEventListener('pointerdown', (event) => {
  if (state.phase !== 'sail-out' && state.phase !== 'sail-return') return;
  if (state.paused) {
    if (!state.pausedByDecision) resumeVoyage();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const target = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  if (!target) return;
  state.desiredHeading = Math.atan2(target.y - state.ship.y, target.x - state.ship.x);
  toast('Helm orders a gradual turn toward the selected bearing.');
});

// Wheel zoom. Clamped hard at both ends: the far limit keeps the ship readable
// and the near limit keeps the perspective from breaking down.
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * .0012);
  camera.zoomTarget = cap(camera.zoomTarget * factor, VIEW.minZoom, VIEW.maxZoom);
}, { passive: false });

// Teacher mode is populated from the same data the game plays with, so the
// written component cannot drift away from the actual content.
function buildTeacherMode() {
  // The seven required Networks of Exchange aspects, each tied to where it appears.
  const aspects = [
    ['Indian Ocean trade routes', 'Every leg of the voyage; the Kilwa–Calicut crossing, the port markets, and the route chart.'],
    ['Cultural diffusion', 'The multilingual port decision at Calicut; language, custom, and knowledge move with goods.'],
    ['Technology', 'Compass, mariner’s astrolabe, lateen sail, and coastal pilot knowledge all change the route.'],
    ['Environment', 'Monsoon timing, reefs, storms, fog, squalls, and shallow water set the terms of the crossing.'],
    ['Trade goods and economics', 'Cargo weight, hold space, port prices, trust, and coin value across both legs.'],
    ['Disease', 'One non-graphic port event about illness arriving from a connected trading centre.'],
    ['Governance and security', 'Harbour rules and paid convoy protection alter the physical safety of the return.'],
  ];
  const aspectsHost = $('teacherNoeAspects');
  if (aspectsHost) aspectsHost.innerHTML = aspects.map(([name, where]) => `<li><b>${name}</b> — ${where}</li>`).join('');
  const networks_ = $('teacherNetworks');
  if (networks_) networks_.innerHTML = networks.map((network) => `<article><h4>${network.name}</h4><p><b>${network.kind}.</b> ${network.span}.</p><p>Challenges: ${network.risk}.</p><p>Goods: ${network.goods}.</p></article>`).join('');
  const tech = $('teacherTech');
  if (tech) tech.innerHTML = technologies.map((item) => `<article><h4><span aria-hidden="true">${item.icon}</span> ${item.name}</h4><p>${item.effect}</p></article>`).join('');
  const people = $('teacherPerspectives');
  if (people) people.innerHTML = perspectives.map((person) => `<article><h4>${person.role}</h4><p><b>Wants:</b> ${person.wants}</p><p class="voice">“${person.voice}”</p></article>`).join('');
  const list = $('teacherSources');
  if (list) list.innerHTML = sources.map((entry) => `<li>${entry}</li>`).join('');
}

function initDeveloperTools() {
  if (location.search.includes('nodev')) $('developerConsole').remove();
  wireDevConsole();
}

resetGame();
buildTeacherMode();
initDeveloperTools();
wireNetworkLegend();
requestAnimationFrame(loop);
})();
