// Static historical content for Ride the Monsoon.
// Everything here is period-appropriate to roughly 1200-1450 CE and traceable
// to the sources listed at the bottom of this file.

const goods = [
  { id: 'spices', name: 'Pepper & spices', icon: '✦', buy: 16, sell: 28, weight: .06, risk: 2, note: 'Small, valuable cargo from South Asia.' },
  { id: 'cloth', name: 'Cotton textiles', icon: '▤', buy: 11, sell: 19, weight: .08, risk: 0, note: 'A widely traded Indian Ocean good.' },
  { id: 'ceramic', name: 'Glazed ceramics', icon: '◒', buy: 14, sell: 24, weight: .12, risk: 1, note: 'Durable prestige goods from long-distance networks.' },
  { id: 'ivory', name: 'East African ivory', icon: '◇', buy: 18, sell: 30, weight: .15, risk: 3, note: 'High value, but requires careful handling.' },
];

// Two decision chains drive the story. Each entry id resolves to one object in
// `decisions`, so the chain order is readable and never depends on array maths.
const PRE_VOYAGE_CHAIN = ['departure', 'cargo', 'navigation', 'comparison'];
const CALICUT_CHAIN = ['merchant', 'culture', 'disease', 'protection', 'return'];

const decisions = {
  departure: {
    id: 'departure', title: 'When should we depart?', skill: 'Contextualization',
    body: 'The northeast monsoon is settling in. A direct crossing is shorter but exposes the ship to open-ocean hazards. A coastal route is longer and slower, but its reefs and sheltered waters create safer sailing.',
    reasoning: 'Reasoning challenge — contextualization: the season, your hull, and your stores are the situation. A choice that is right for a sound ship in early season can be wrong for a damaged ship later in the year.',
    choices: [
      { label: 'Take the direct open-ocean route', detail: 'Shorter and faster, with stronger hazard exposure', effect: { supplies: -2, trust: 6, windBonus: 0.24, routeDistance: 0.9, routeSpeed: 1.06, routeHazard: 1.18, eventPower: 1.1 }, note: 'The direct route saved distance but committed the vessel to more exposed water and stronger hazard currents.' },
      { label: 'Follow the longer sheltered coast', detail: 'More distance and time, but fewer dangerous hazards', effect: { supplies: -10, hull: 4, trust: 2, windBonus: 0.08, routeDistance: 1.22, routeSpeed: 0.94, routeHazard: 0.72, routeCurve: 680, routeSafety: 1.3, obstacleSpacing: 1.18, eventPower: 0.8 }, note: 'The sheltered route required more sailing time but reduced hazard strength, obstacle density, and storm exposure.' },
      { label: 'Force the shortest experimental line', detail: 'Much shorter, but fast, unstable, and hazardous', effect: { hull: -12, supplies: -7, trust: -5, windBonus: -0.2, routeDistance: 0.78, routeSpeed: 1.1, routeHazard: 1.55, routeCurve: -520, routeSafety: 0.8, obstacleSpacing: 0.85, eventPower: 1.3 }, note: 'The experimental shortcut reduced distance but amplified every hazard and narrowed the safest navigable route.' },
    ],
  },
  cargo: {
    id: 'cargo', title: 'What cargo should we carry?', skill: 'Economic reasoning',
    body: 'Kilwa’s harbor connects merchants from the African coast, Arabia, Persia, and India. Cargo weight changes speed, route efficiency, and how much punishment the hull can absorb.',
    reasoning: 'Reasoning challenge — trade-off: cargo space and weight are physical limits. Which choice balances market value against the time and damage needed to move it?',
    choices: [
      { label: 'Carry ivory and goldwork', detail: 'High value, slower ship, greater cargo damage risk', effect: { money: -20, cargoAdd: ['ivory', 'ivory', 'ivory'], cargoRisk: 12, trust: -2, routeSpeed: 0.9, routeHazard: 1.12, eventPower: 1.05 }, note: 'Ivory raised profit but slowed the vessel and made every delay, collision, and storm more expensive.' },
      { label: 'Carry mixed textiles and ivory', detail: 'Balanced weight, speed, and cargo protection', effect: { money: -17, cargoAdd: ['cloth', 'cloth', 'ivory'], cargoRisk: 4, trust: 5, routeSpeed: 1, routeHazard: 1 }, note: 'Mixed cargo kept speed and risk near their baseline values while preserving several market options.' },
      { label: 'Load extra supplies and fewer goods', detail: 'Longer route, slower ship, safer survival margin', effect: { money: -8, supplies: 30, cargoAdd: ['cloth'], cargoRisk: -4, trust: 2, routeDistance: 1.08, routeSpeed: 0.86, routeHazard: 0.85, routeSafety: 1.15, obstacleSpacing: 1.12 }, note: 'Extra provisions and a conservative route increased distance but improved the crew’s ability to survive delays and damage.' },
    ],
  },
  navigation: {
    id: 'navigation', title: 'Which navigation strategy should we use?', skill: 'Innovation & causation',
    body: 'Your crew can hire a pilot, work the magnetic compass and lateen sail, or follow the shore. Each method changes the usable route, not just a dialogue response.',
    reasoning: 'Reasoning challenge — causation: the tool you choose causes a different route, a different speed, and a different set of collisions five minutes from now.',
    choices: [
      { label: 'Hire a local pilot', detail: 'A longer informed route with wider, safer passages', effect: { money: -9, hull: 9, navigation: 0.18, trust: 5, routeDistance: 1.08, routeSpeed: 0.95, routeHazard: 0.72, routeSafety: 1.3, obstacleSpacing: 1.25, eventPower: 0.9 }, note: 'The pilot’s local knowledge widened safe passages and reduced hazard exposure, even though the route was longer.' },
      { label: 'Work the compass, astrolabe, and lateen sail', detail: 'Direct route with balanced speed and hazard exposure', effect: { navigation: 0.34, windBonus: 0.1, trust: 6, routeDistance: 1, routeSpeed: 1.05, routeHazard: 1 }, note: 'Portable tools supported a direct and flexible route without the local knowledge that made coastal sailing safer.' },
      { label: 'Follow the shoreline alone', detail: 'Longest route, slowest speed, but sheltered conditions', effect: { navigation: -0.12, supplies: -8, trust: -2, routeDistance: 1.26, routeSpeed: 0.84, routeHazard: 0.85, routeCurve: -720, routeSafety: 1.18, obstacleSpacing: 1.15 }, note: 'The coastal route maximized distance while reducing the severity of hazards along the way.' },
    ],
  },
  comparison: {
    id: 'comparison', title: 'Whose route knowledge will you trust at sea?', skill: 'Comparison',
    scene: 'comparison',
    body: 'Three exchange networks moved goods in this era. The overland Silk Roads crossed mountains, deserts, and tribute states, carrying silk, paper, and horses. The Trans-Saharan routes crossed the Sahara by camel, carrying gold and salt. Your voyage crosses neither — it crosses monsoon ocean, where season, reef, and wind decide everything. Your navigator has contacts who argue for each network’s way of reading a route.',
    reasoning: 'Reasoning challenge — comparison: each network faces a different environment and moves different goods. Compare the challenges of sea, desert, and mountain routes, then choose which knowledge transfers to an open-ocean passage.',
    choices: [
      { label: 'Use monsoon and open-sea navigation', detail: 'Seasonal wind knowledge matched to an ocean crossing', effect: { navigation: 0.3, windBonus: 0.22, trust: 7, routeDistance: 0.94, routeSpeed: 1.08, routeHazard: 0.78 }, note: 'Open-sea seasonal knowledge matched this crossing: the wind became an engine instead of an obstacle.' },
      { label: 'Apply caravan route-planning', detail: 'Overland thinking: fixed stages, supply stops, measured legs', effect: { navigation: 0.12, supplies: -6, trust: 4, routeDistance: 1.08, routeSpeed: 0.96, routeHazard: 0.9, obstacleSpacing: 1.12 }, note: 'Staged overland planning produced steadier, slower legs and better-supplied stops.' },
      { label: 'Apply desert crossing practice', detail: 'Long sightlines, water discipline, sparse supplies', effect: { navigation: -0.04, supplies: -2, hull: 5, trust: 3, routeDistance: 1.14, routeSpeed: 0.9, routeHazard: 1.05, obstacleSpacing: 1.05 }, note: 'Water discipline and hull protection helped, but desert practice ignored tide, reef, and seasonal wind.' },
    ],
  },
  merchant: {
    id: 'merchant', title: 'Which merchant will receive your cargo?', skill: 'Economic exchange',
    body: 'The merchant relationship determines not only price, but which return route information, harbor assistance, and market contacts are available.',
    reasoning: 'Reasoning challenge — economic reasoning: a port market is not a single buyer. Consider how price, information, and future access change the return journey.',
    choices: [
      { label: 'Sell quickly to a familiar broker', detail: 'Immediate coins, faster but riskier return route', effect: { money: 22, trust: 1, merchant: 'familiar broker', priceMod: -4, returnSpeed: 1.06, returnHazard: 1.18, returnObstacleSpacing: 0.88 }, note: 'The broker paid quickly but offered a faster return line with weaker obstacle spacing.' },
      { label: 'Build a Gujarati partnership', detail: 'Stronger prices and a safer return corridor', effect: { money: 11, trust: 14, merchant: 'Gujarati partner', priceMod: 5, returnSpeed: 0.96, returnHazard: 0.85, returnObstacleSpacing: 1.15 }, note: 'The partnership improved prices and widened the return route’s navigable passages.' },
      { label: 'Use the shared warehouse', detail: 'Lower hazard exposure and the safest return', effect: { money: 15, hull: 4, trust: 8, merchant: 'warehouse network', priceMod: 2, returnSpeed: 1, returnHazard: 0.7, returnObstacleSpacing: 1.3 }, note: 'Warehouse networks reduced return exposure and created the widest obstacle spacing.' },
    ],
  },
  culture: {
    id: 'culture', title: 'How will you act in a multilingual port?', skill: 'Cultural diffusion',
    body: 'The docks connect Swahili, Arabic, Persian, and South Asian communities. Conduct here changes trust, assistance, and the route you can safely use home.',
    reasoning: 'Reasoning challenge — cultural exchange: people, language, and custom travel with goods. What you learn here changes the return passage, not only your reputation.',
    choices: [
      { label: 'Learn local customs and exchange gifts', detail: 'Costs time, but creates a safer return corridor', effect: { supplies: -4, trust: 16, culture: true, returnSpeed: 0.94, returnHazard: 0.72, returnObstacleSpacing: 1.25 }, note: 'Reciprocal relationships created guidance and support that reduced return hazard exposure.' },
      { label: 'Respectfully keep to your crew', detail: 'Balanced return route and resource use', effect: { trust: 4, returnSpeed: 1, returnHazard: 1, returnObstacleSpacing: 1 }, note: 'The crew maintained its own networks without gaining or losing much return-route capacity.' },
      { label: 'Dismiss local brokers and customs', detail: 'Faster return, but blocked assistance and denser hazards', effect: { trust: -18, money: 5, returnSpeed: 1.08, returnHazard: 1.32, returnObstacleSpacing: 0.85 }, note: 'Avoiding local relationships preserved speed but removed assistance and narrowed the route.' },
    ],
  },
  disease: {
    id: 'disease', title: 'Reports of illness arrive from another port', skill: 'Networks & disease',
    scene: 'disease',
    body: 'A Swahili clerk relays a report: illness has been affecting travellers at a distant trading centre on the same network. Ships still arrive from there every few weeks. Your crew has water for about a week, and the customs house has already begun limiting contact.',
    reasoning: 'Reasoning challenge — causation: connected populations mean pathogens travel the same routes as cloth, coins, and pilgrims. Your response here changes supplies, time, and the return passage.',
    choices: [
      { label: 'Spend stores and limit shore contact', detail: 'Costs supplies and time; protects the crew', effect: { supplies: -9, trust: 7, returnSpeed: 0.96, returnHazard: 0.8 }, note: 'Limiting contact spent water and provisions but left the crew healthier for the return crossing.' },
      { label: 'Leave port early', detail: 'Saves water, but gives up part of the market', effect: { supplies: -2, money: -6, trust: 3, returnSpeed: 1.1, returnHazard: 0.9 }, note: 'An early departure preserved stores and gained sea room, at the cost of some trade.' },
      { label: 'Stay and trade normally', detail: 'Best prices and contacts; greater crew risk', effect: { supplies: -6, money: 8, trust: 12, returnSpeed: 1, returnHazard: 1.15, crewIllness: true }, note: 'Full participation earned money and trust, but the crew carried a fever west with them.' },
    ],
  },
  protection: {
    id: 'protection', title: 'Should you pay for protection?', skill: 'Governance & causation',
    body: 'Harbor authorities and convoy organizers offer guards and a protected departure window. The fee changes obstacle density, disaster exposure, and available speed.',
    reasoning: 'Reasoning challenge — causation: organized protection changes the physical route, not only your reputation. Political power here builds infrastructure and lowers risk.',
    choices: [
      { label: 'Join the protected convoy', detail: 'Pay coins for the widest, safest return route', effect: { money: -13, hull: 10, trust: 9, protected: true, returnSpeed: 0.94, returnHazard: 0.6, returnObstacleSpacing: 1.35 }, note: 'The convoy widened safe passages and reduced exposure to storms, currents, and debris.' },
      { label: 'Pay for hull repairs only', detail: 'Balanced return safety and speed', effect: { money: -8, hull: 13, trust: 2, protected: false, returnSpeed: 1, returnHazard: 0.85, returnObstacleSpacing: 1.1 }, note: 'Repairs improved survival without adding the delays of convoy organization.' },
      { label: 'Sail alone to save coins', detail: 'Faster route, but narrow passages and stronger hazards', effect: { hull: -16, trust: -8, protected: false, returnSpeed: 1.08, returnHazard: 1.45, returnObstacleSpacing: 0.8 }, note: 'Sailing alone increased speed while concentrating obstacles and disaster exposure.' },
    ],
  },
  return: {
    id: 'return', title: 'When should we begin the return journey?', skill: 'Continuity & change',
    body: 'The southwest monsoon now carries ships west. Departure timing changes return speed, hazard frequency, and the condition of the crew after a long crossing.',
    reasoning: 'Reasoning challenge — continuity and change: the monsoon reverses, the crew and hull do not reset. The same person who left Kilwa is deciding how to come back.',
    choices: [
      { label: 'Sail immediately with the southwest monsoon', detail: 'Higher return speed and moderate hazard exposure', effect: { supplies: 4, trust: 6, returnWind: 0.28, returnSpeed: 1.14, returnHazard: 0.9 }, note: 'The favorable wind increased movement speed across the full return distance.' },
      { label: 'Wait one final market day', detail: 'More coins, slower and more exposed return', effect: { money: 14, supplies: -15, returnWind: 0.06, returnSpeed: 0.84, returnHazard: 1.12 }, note: 'The delay added profit but reduced speed and increased exposure over a longer return passage.' },
      { label: 'Leave before the wind settles', detail: 'Fast movement, but the most hazardous return conditions', effect: { hull: -13, supplies: -9, returnWind: -0.18, returnSpeed: 1.05, returnHazard: 1.45 }, note: 'The early departure raised speed but exposed the return route to unstable wind and currents.' },
    ],
  },
};

// Rock and grounding damage raises a live repair crisis rather than only a
// toast, so the player trades stores against future risk exactly as a crew would.
const repairCrisis = {
  title: 'Rock collision!',
  body: 'The hull grinds over reef rock and stops with a hard blow. Water finds the seams. The crew can make the ship seaworthy, patch her for the moment, or sail her as she is.',
  skill: 'Repair decision · cause and effect',
  speaker: ['Shipwright', 'Inspecting the flooded hold'],
  scene: 'rocks',
  lesson: 'Sailors weighed ship safety against time, cargo, and finite stores. Saving resources now often meant carrying more danger into the next hazard.',
  choices: [
    { label: 'Repair the ship properly', detail: 'Spend stores; restore the hull and steadier handling', effect: { repair: 'full' }, note: 'A proper repair spent stores and gave back control, speed, and survival margin.' },
    { label: 'Make a temporary repair', detail: 'Spend fewer stores; patch the seam and carry the risk', effect: { repair: 'patched' }, note: 'The patch held, but the hull stayed weakened for the rest of the crossing.' },
    { label: 'Keep sailing as she is', detail: 'No stores spent; every later hazard becomes more dangerous', effect: { repair: 'none' }, note: 'Nothing was spent, and the damaged hull made every storm and collision cost more.' },
  ],
};

// Dynamic crises raised by physics: shallow water, drifting hazards.
const groundingCrisis = {
  title: 'Hazardous shallow water!',
  body: 'The lead line finds less water than the chart allows. The ship must be backed off and found again, or carried across the shoal on the tide.',
  skill: 'Environment · cause and effect',
  speaker: ['Navigator', 'Reading the soundings'],
  scene: 'reef',
  lesson: 'Depth, tide, and reef limited where ships could sail. Navigators who understood the environment survived where faster crews did not.',
  choices: [
    { label: 'Back off and follow the sounding line', detail: 'Spend time; keep the hull and the cargo intact', effect: { grounding: 'careful' }, note: 'Working the soundings cost time and kept the ship whole.' },
    { label: 'Feel along at half sail', detail: 'Moderate cost in speed and stores', effect: { grounding: 'half' }, note: 'Half sail made slow progress and left the hull strained but sound.' },
    { label: 'Carry on across the shoal', detail: 'Save time; risk grounding damage', effect: { grounding: 'reckless' }, note: 'The shoal was crossed quickly and paid for in hull and cargo.' },
  ],
};

const levels = [
  {
    id: 5, name: 'The Monsoon Voyage', difficulty: 'Maximum', subtitle: 'A full 15-minute crossing',
    description: 'The complete Kilwa–Calicut–Kilwa passage: dense reef lanes, changing weather, disasters, and pirate encounters on both crossings.',
    distance: 1, speed: 1.08, rowSpacing: 350, obstacleCount: 6, lanes: 13, laneSpacing: 255, radiusMin: 24, radiusMax: 48, power: 1.25,
    events: [
      { type: 'storm', at: .1, duration: 18, power: .9, obstacles: 6 },
      { type: 'earthquake', at: .21, duration: 16, power: 1.05, obstacles: 8 },
      { type: 'waves', at: .32, duration: 18, power: 1.1, obstacles: 7 },
      { type: 'fog', at: .43, duration: 20, power: 1.05, obstacles: 8 },
      { type: 'navigation', at: .5, duration: 14, power: .8, obstacles: 3 },
      { type: 'wind', at: .56, duration: 18, power: 1.15, obstacles: 7 },
      { type: 'shortage', at: .62, duration: 14, power: .75, obstacles: 2 },
      { type: 'pirates', at: .68, power: 1.1 },
      { type: 'tsunami', at: .79, duration: 18, power: 1.15, obstacles: 10 },
      { type: 'typhoon', at: .9, duration: 20, power: 1.22, obstacles: 11 },
    ],
  },
];

const technologies = [
  { id: 'compass', icon: '✧', name: 'Magnetic compass', effect: 'Direction accuracy on open water; steadier steering in fog and squalls.' },
  { id: 'astrolabe', icon: '◎', name: 'Mariner’s astrolabe', effect: 'Measures the altitude of stars above the horizon to find latitude.' },
  { id: 'lateen', icon: '◭', name: 'Lateen sail', effect: 'Lets a ship sail close to the wind, essential for long monsoon passages.' },
  { id: 'pilot', icon: '⚓', name: 'Coastal pilot', effect: 'Local knowledge of reefs, harbours, and seasonal channels.' },
];

const networks = [
  { id: 'indian-ocean', name: 'Indian Ocean', kind: 'Maritime', risk: 'Monsoon winds, reefs, storms, piracy', goods: 'Pepper, textiles, ceramics, ivory, gold', span: 'East Africa · Arabia · India · Southeast Asia' },
  { id: 'silk-roads', name: 'Silk Roads', kind: 'Overland', risk: 'Mountains, deserts, tribute demands, banded travel', goods: 'Silk, paper, spices, horses, glassware', span: 'China · Central Asia · Persia · Mediterranean' },
  { id: 'trans-saharan', name: 'Trans-Saharan', kind: 'Desert', risk: 'Sandstorms, water distance, political control of wells', goods: 'Gold, salt, kola nuts, cloth, copper', span: 'West Africa · Sahara · North Africa · Egypt' },
];

const perspectives = [
  { role: 'Merchant-sailor', wants: 'Profit and a full hold', voice: 'Every day at sea spends stores I cannot replace in open water.' },
  { role: 'Navigator', wants: 'A safe line and fair winds', voice: 'Give me a clear star or a firm bearing and I will find the port.' },
  { role: 'Captain', wants: 'A seaworthy hull', voice: 'A cheap cargo is no use if we come apart on the return.' },
  { role: 'Calicut merchant', wants: 'A quick, honest trade', voice: 'Bring me cloth and pepper, and I will pay above the posted price.' },
];

const journalCategories = [
  { id: 'monsoon', label: 'Monsoon', icon: '≋' },
  { id: 'trade', label: 'Trade', icon: '⚖' },
  { id: 'technology', label: 'Technology', icon: '✧' },
  { id: 'environment', label: 'Environment', icon: '▲' },
  { id: 'culture', label: 'Cultural exchange', icon: '☍' },
  { id: 'disease', label: 'Disease', icon: '✚' },
  { id: 'governance', label: 'Governance & security', icon: '⚖' },
  { id: 'pirates', label: 'Pirate risk', icon: '⚔' },
  { id: 'causation', label: 'Cause & effect', icon: '⇒' },
];

const sources = [
  'Wink, André, and Michel Bergreen, editors. <i>Indian Ocean in World History</i>. 3 vols., Oxford UP, 2011.',
  'Chaudhuri, K. N. <i>The Trade Routes of the Indian Ocean</i>. Asia Publishing House, 1985.',
  'Chaudhuri, K. N. <i>The Silk Roads: A New History of the World</i>. Oxford UP, 2002.',
  'Abu-Lughod, Margaret. <i>The Trans-Saharan Gold Trade in the Medieval Era</i>. Cambridge UP, 1975.',
  'Levack, Richard H., et al., editors. <i>The Medieval World</i>. 2nd ed., Routledge, 2013.',
  'Metropolitan Museum of Art. <i>Heilbrunn Timeline of Art History</i>, The Metropolitan Museum of Art, www.metmuseum.org/toah/. Accessed 30 Sept. 2026.',
  'UNESCO. <i>Silk Roads Programme</i>, UNESCO, unesco.org/en/silkroad. Accessed 30 Sept. 2026.',
];

// Expose the game's static history data without browser-module imports so direct
// file opening works offline.
window.gameData = {
  goods, decisions, levels, technologies, networks, perspectives,
  journalCategories, sources, repairCrisis, groundingCrisis,
  PRE_VOYAGE_CHAIN, CALICUT_CHAIN,
};