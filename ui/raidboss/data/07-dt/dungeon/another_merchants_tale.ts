import Conditions from '../../../../../resources/conditions';
import { Responses } from '../../../../../resources/responses';
import ZoneId from '../../../../../resources/zone_id';
import { RaidbossData } from '../../../../../types/data';
import { NetMatches } from '../../../../../types/net_matches';
import { TriggerSet } from '../../../../../types/trigger';

// Another Merchant's Tale (criterion dungeon)
// 1: Darya the Sea-maid (The Sea-Maid's Mirror)
// 2: Lone Swordmaster (The Wound of the Heavens)
// 3: Pari of Plenty

export interface Data extends RaidbossData {
  daryaFamiliarOrder: string[];
  daryaFamiliarOrderSaved: string[];
  lsmHasUnyieldingWill: boolean;
  lsmTakeTetherDone: boolean;
  lsmMaleficMask: number;
  lsmWillCasters: { x: number; z: number }[];
  lsmWillActive: boolean;
  lsmPortentTetherSide: number;
  lsmLargeWillCasters: { x: number; z: number }[];
  lsmRocks: { x: number; z: number }[];
}

// During Familiar Call, the boss emits one ActorControlExtra (line 273) VFX per
// summoned familiar, ~1s apart, in the order they will fire their Watersong AoE.
// This lands ~8s before the first AoE resolves, so we can show the full order ahead.
// param1 is the VFX id (matches BossMod's VfxID enum).
const familiarVfxToAnimal: { [param1: string]: string } = {
  'AB5': 'seahorse', //   Seaborn Steed   -- line
  'AB7': 'turtle', //     Seaborn Steward -- line
  'AB8': 'crab', //       Seaborn Soldier -- line
  'AB9': 'pufferfish', // Seaborn Servant -- wide cone
  'ABA': 'chocobo', //    Seaborn Shrike  -- narrow cone
};

// Alluring Order applies a directional Forced March status (871-874) with the full
// duration until it resolves (~18s); the actual march (4E9) fires at expiry.
const effectIdToForcedMarchDir: { [effectId: string]: string } = {
  '871': 'forward', // Forward March
  '872': 'backward', // About Face
  '873': 'left', //    Left Face
  '874': 'right', //   Right Face
};

// Lone Swordmaster - Malefic. Each player carries a "Malefic" status whose id encodes a
// bitmask of UNSAFE sides (mask = statusId(dec) - 4772). The game updates the status as
// sides are added, so it is always the current truth. Matches BossMod's Malefic component
// (statuses 4773-4787, Side { E=1, W=2, S=4, N=8 }).
const maleficSideStatusIds = Array.from(
  { length: 15 },
  (_, i) => (0x12a5 + i).toString(16).toUpperCase(),
);

// Malefic2 "Will of the Underworld": four rects hit the inner tiles, one from each edge,
// covering one inner column/row each. Arena center (170, -815). A caster's edge is the
// side its attack comes FROM. An inner tile is hit from its column's vertical attack and
// its row's horizontal attack; a player is safe where both come from their safe sides.
const lsmCenterX = 170;
const lsmCenterZ = -815;
const lsmCasterFromSide = (x: number, z: number): number => {
  if (z < -830)
    return 8; // N edge
  if (z > -800)
    return 4; // S edge
  if (x > 185)
    return 1; // E edge
  if (x < 155)
    return 2; // W edge
  return 0;
};

// Malefic2 "Will of the Underworld (Large)" (BA93, enrage phase): a 4-wave version where
// each of the four casters (one per edge) throws a WIDTH-20 rect covering HALF the arena
// (not a single lane), gated by the player's Malefic side as usual. Two "Fallen Rock"
// pillars spawn on a diagonal; a rect is blocked in a rock's shadow, so the only safe spot
// is tucked behind a rock. Each player keeps ONE safe side for all four waves; only the
// casters rotate (a pinwheel: opposite edges always cover opposite halves), so the safe
// rock + side changes each wave.
//
// Resolve (validated against every logged wave + every surviving player position):
//  - A player with safe side E/W is threatened by the N+S pair (vertical beams) plus one of
//    E/W. The single E/W caster covers a z-half, so the player's safe z-half is the other;
//    stand on THAT side (N or S) of the rock that sits in the column of the N/S caster firing
//    toward that safe half.
//  - Symmetric for safe side N/S: the single N/S caster fixes the safe x-half; stand on that
//    side (E or W) of the rock in the row of the E/W caster firing toward it.
type LsmRock = { x: number; z: number };
const lsmLargeWillResolve = (
  safe: number, // safe-side bit (E=1,W=2,S=4,N=8)
  casters: { x: number; z: number }[],
  rocks: LsmRock[],
): { side: 'north' | 'south' | 'east' | 'west'; rock: string; zone: string } | undefined => {
  const edge = (bit: number) => casters.find((c) => lsmCasterFromSide(c.x, c.z) === bit);
  const n = edge(8); const s = edge(4); const e = edge(1); const w = edge(2);
  if (n === undefined || s === undefined || e === undefined || w === undefined)
    return undefined;
  const west = rocks.find((r) => r.x < lsmCenterX);
  const east = rocks.find((r) => r.x >= lsmCenterX);
  const north = rocks.find((r) => r.z < lsmCenterZ);
  const south = rocks.find((r) => r.z >= lsmCenterZ);
  const quad = (r: LsmRock) => `${r.z < lsmCenterZ ? 'N' : 'S'}${r.x < lsmCenterX ? 'W' : 'E'}`;
  if (safe === 1 || safe === 2) {
    // safe E/W: the single unsafe horizontal caster is W (if safe E) or E (if safe W).
    const h = safe === 1 ? w : e;
    const safeNorth = h.z >= lsmCenterZ; // h covers south -> safe half is north
    const shooter = safeNorth ? s : n; // caster firing toward the safe z-half
    const rock = shooter.x < lsmCenterX ? west : east;
    if (rock === undefined)
      return undefined;
    // The shadow strip lives in the safe z-half, in the rock's column -- which can be a
    // DIFFERENT quadrant than the rock itself (e.g. a south rock's shadow reaching north).
    const zoneQuad = `${safeNorth ? 'N' : 'S'}${rock.x < lsmCenterX ? 'W' : 'E'}`;
    return { side: safeNorth ? 'north' : 'south', rock: quad(rock), zone: zoneQuad };
  }
  // safe N/S: the single unsafe vertical caster is S (if safe N) or N (if safe S).
  const v = safe === 8 ? s : n;
  const safeEast = v.x < lsmCenterX; // v covers west -> safe half is east
  const shooter = safeEast ? w : e; // W fires east, E fires west
  const rock = shooter.z < lsmCenterZ ? north : south;
  if (rock === undefined)
    return undefined;
  const zoneQuad = `${rock.z < lsmCenterZ ? 'N' : 'S'}${safeEast ? 'E' : 'W'}`;
  return { side: safeEast ? 'east' : 'west', rock: quad(rock), zone: zoneQuad };
};

// Per-position output config for Will of the Underworld: each of the 8 safe spots can be
// reported as its direction or as a specific waymark (there is no single convention for
// where groups place marks, so this is fully configurable).
const willWaymarkOptions = {
  en: {
    'Direction': 'dir',
    'A': 'A',
    'B': 'B',
    'C': 'C',
    'D': 'D',
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
  },
};

// Shared by the Familiar Order and Echoed Reprise triggers (Reprise replays the order).
const familiarOutputStrings = {
  order: {
    en: '${order}',
    de: '${order}',
    fr: '${order}',
    ja: '${order}',
    cn: '${order}',
    ko: '${order}',
  },
  chocobo: {
    en: 'Chocobo',
    de: 'Chocobo',
    fr: 'Chocobo',
    ja: 'チョコボ',
    cn: '陆行鸟',
    ko: '초코보',
  },
  crab: {
    en: 'Crab',
    de: 'Krabbe',
    fr: 'Crabe',
    ja: 'カニ',
    cn: '螃蟹',
    ko: '게',
  },
  seahorse: {
    en: 'Seahorse',
    de: 'Seepferdchen',
    fr: 'Hippocampe',
    ja: 'タツノオトシゴ',
    cn: '海马',
    ko: '해마',
  },
  pufferfish: {
    en: 'Pufferfish',
    de: 'Kugelfisch',
    fr: 'Poisson-globe',
    ja: 'フグ',
    cn: '河豚',
    ko: '복어',
  },
  turtle: {
    en: 'Turtle',
    de: 'Schildkröte',
    fr: 'Tortue',
    ja: 'カメ',
    cn: '乌龟',
    ko: '거북이',
  },
} as const;

const triggerSet: TriggerSet<Data> = {
  id: 'AnotherMerchantsTale',
  zoneId: ZoneId.AnotherMerchantsTale,
  config: [
    // Will of the Underworld: for each of the 8 safe spots, output its direction or a
    // chosen waymark. Inner tiles = NW/NE/SW/SE; outer cardinals = N/E/S/W.
    {
      id: 'willMarkNW',
      name: { en: 'Will of the Underworld: NW inner tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkNE',
      name: { en: 'Will of the Underworld: NE inner tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkSW',
      name: { en: 'Will of the Underworld: SW inner tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkSE',
      name: { en: 'Will of the Underworld: SE inner tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkN',
      name: { en: 'Will of the Underworld: North outer tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkE',
      name: { en: 'Will of the Underworld: East outer tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkS',
      name: { en: 'Will of the Underworld: South outer tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
    {
      id: 'willMarkW',
      name: { en: 'Will of the Underworld: West outer tile' },
      type: 'select',
      options: willWaymarkOptions,
      default: 'dir',
    },
  ],
  timelineFile: 'another_merchants_tale.txt',
  initData: () => ({
    daryaFamiliarOrder: [],
    daryaFamiliarOrderSaved: [],
    lsmHasUnyieldingWill: false,
    lsmTakeTetherDone: false,
    lsmMaleficMask: 0,
    lsmWillCasters: [],
    lsmWillActive: false,
    lsmPortentTetherSide: 0,
    lsmLargeWillCasters: [],
    lsmRocks: [],
  }),
  triggers: [
    {
      // Familiar Call summons a fresh set. Save the previous order (Echoed Reprise
      // replays it with no new VFX of its own), then clear the running order.
      id: 'AMT Darya Familiar Call Reset',
      type: 'StartsUsing',
      netRegex: { id: 'B2CB', source: 'Darya the Sea-maid', capture: false },
      run: (data) => {
        data.daryaFamiliarOrderSaved = data.daryaFamiliarOrder;
        data.daryaFamiliarOrder = [];
      },
    },
    {
      // One VFX (category 00B8) per familiar, ~1s apart, in firing order.
      // Silently collect the animal keys as they arrive.
      id: 'AMT Darya Familiar Order Collect',
      type: 'ActorControlExtra',
      netRegex: { category: '00B8', param1: Object.keys(familiarVfxToAnimal) },
      run: (data, matches: NetMatches['ActorControlExtra']) => {
        const animal = familiarVfxToAnimal[matches.param1];
        if (animal !== undefined)
          data.daryaFamiliarOrder.push(animal);
      },
    },
    {
      // Fire once, ~1s after the last VFX, to show the complete order. suppressSeconds
      // keeps it to a single callout; durationSeconds holds it through the resolves.
      id: 'AMT Darya Familiar Order',
      type: 'ActorControlExtra',
      netRegex: { category: '00B8', param1: Object.keys(familiarVfxToAnimal), capture: false },
      delaySeconds: 4,
      durationSeconds: 20,
      suppressSeconds: 15,
      infoText: (data, _matches, output) => {
        if (data.daryaFamiliarOrder.length === 0)
          return;
        const names = data.daryaFamiliarOrder.map((animal) => output[animal]!());
        return output.order!({ order: names.join(' > ') });
      },
      outputStrings: familiarOutputStrings,
    },
    {
      // Echoed Reprise replays the previous Echoed Serenade's familiar order (the
      // familiars are repositioned but fire in the same sequence, with no new VFX).
      // Re-show the saved order from the reprise cast through its resolves.
      id: 'AMT Darya Echoed Reprise',
      type: 'StartsUsing',
      netRegex: { id: 'B314', source: 'Darya the Sea-maid', capture: false },
      durationSeconds: 17,
      infoText: (data, _matches, output) => {
        if (data.daryaFamiliarOrderSaved.length === 0)
          return;
        const names = data.daryaFamiliarOrderSaved.map((animal) => output[animal]!());
        return output.order!({ order: names.join(' > ') });
      },
      outputStrings: familiarOutputStrings,
    },
    {
      // Directional Forced March from Alluring Order. The 871-874 status is applied
      // ~18s before it resolves; delay to call it out ~5s before the actual march.
      id: 'AMT Darya Forced March',
      type: 'GainsEffect',
      netRegex: { effectId: Object.keys(effectIdToForcedMarchDir) },
      condition: Conditions.targetIsYou(),
      delaySeconds: (_data, matches) => Math.max(0, parseFloat(matches.duration) - 5),
      durationSeconds: 8,
      infoText: (_data, matches, output) => {
        const dir = effectIdToForcedMarchDir[matches.effectId];
        if (dir !== undefined)
          return output[dir]!();
      },
      outputStrings: {
        forward: {
          en: 'Forced March: Forward',
          de: 'Geistlenkung: vorwärts',
          fr: 'Marche forcée : Avant',
          ja: '強制移動: 前',
          cn: '强制移动: 前',
          ko: '강제이동: 앞',
        },
        backward: {
          en: 'Forced March: Backward',
          de: 'Geistlenkung: rückwärts',
          fr: 'Marche forcée : Arrière',
          ja: '強制移動: 後',
          cn: '强制移动: 后',
          ko: '강제이동: 뒤',
        },
        left: {
          en: 'Forced March: Left',
          de: 'Geistlenkung: links',
          fr: 'Marche forcée : Gauche',
          ja: '強制移動: 左',
          cn: '强制移动: 左',
          ko: '강제이동: 왼쪽',
        },
        right: {
          en: 'Forced March: Right',
          de: 'Geistlenkung: rechts',
          fr: 'Marche forcée : Droite',
          ja: '強制移動: 右',
          cn: '强制移动: 右',
          ko: '강제이동: 오른쪽',
        },
      },
    },
    {
      // Near/Far to Heaven: Near resolves pointblank-first, Far resolves donut-first.
      // Simple heads-up on cast start (a fancier resolver could come later).
      id: 'AMT LSM Near Far to Heaven',
      type: 'StartsUsing',
      netRegex: { id: ['B9CE', 'B9CF', 'B9D0', 'B9D1'], source: 'Lone Swordmaster' },
      infoText: (_data, matches, output) => {
        const isNear = matches.id === 'B9CE' || matches.id === 'B9D0';
        return isNear ? output.pointblankFirst!() : output.donutFirst!();
      },
      outputStrings: {
        pointblankFirst: {
          en: 'Pointblank first',
          de: 'Nah zuerst',
          fr: 'Proche d\'abord',
          ja: '近づく',
          cn: '先靠近',
          ko: '안쪽 먼저',
        },
        donutFirst: {
          en: 'Donut first',
          de: 'Donut zuerst',
          fr: 'Donut d\'abord',
          ja: 'ドーナツ',
          cn: '先月环',
          ko: '도넛 먼저',
        },
      },
    },
    {
      // Reset per-phase markers at the start of each Malefic Quartering.
      id: 'AMT LSM Malefic Quartering Reset',
      type: 'StartsUsing',
      netRegex: { id: 'B665', source: 'Lone Swordmaster', capture: false },
      run: (data) => {
        data.lsmHasUnyieldingWill = false;
        data.lsmWillActive = false;
        data.lsmPortentTetherSide = 0;
      },
    },
    {
      // Unyielding Will (tether 0173, from the Force of Will adds) is the unswappable
      // attack: it forces its target to keep one safe side, so those players must pass
      // the directional tether rather than take it. Mark whoever it lands on.
      id: 'AMT LSM Unyielding Will On You',
      type: 'Tether',
      netRegex: { id: '0173' },
      condition: Conditions.targetIsYou(),
      run: (data) => data.lsmHasUnyieldingWill = true,
    },
    {
      // The two players WITHOUT Unyielding Will take the directional tether (gaining the
      // 4th unsafe side). This swap only happens for the FIRST tether set (~45s in); all
      // later Malefic Portent tethers are sticky, so fire at most once per pull.
      id: 'AMT LSM Take Tether',
      type: 'Tether',
      netRegex: { id: '0173' },
      condition: (data, matches) => !data.lsmTakeTetherDone && matches.targetId.startsWith('10'),
      delaySeconds: 0.3,
      suppressSeconds: 5,
      alertText: (data, _matches, output) => {
        data.lsmTakeTetherDone = true;
        if (!data.lsmHasUnyieldingWill)
          return output.takeTether!();
      },
      outputStrings: {
        takeTether: {
          en: 'Take Tether',
          de: 'Verbindung nehmen',
          fr: 'Prends le lien',
          ja: '線を取る',
          cn: '接线',
          ko: '선 가로채기',
        },
      },
    },
    {
      // Track the player's current Malefic unsafe-side bitmask (used by Will of the
      // Underworld). The status id always reflects the current sides.
      id: 'AMT LSM Malefic Sides Track',
      type: 'GainsEffect',
      netRegex: { effectId: maleficSideStatusIds },
      condition: Conditions.targetIsYou(),
      run: (data, matches) => data.lsmMaleficMask = parseInt(matches.effectId, 16) - 4772,
    },
    {
      id: 'AMT LSM Malefic Sides Clear',
      type: 'LosesEffect',
      netRegex: { effectId: maleficSideStatusIds },
      condition: Conditions.targetIsYou(),
      run: (data, matches) => {
        if (parseInt(matches.effectId, 16) - 4772 === data.lsmMaleficMask)
          data.lsmMaleficMask = 0;
      },
    },
    {
      // Maw of the Wolf: half-room rect from the boss, resolving just before the first
      // Will of the Underworld wave -- stand behind the boss. Hold until it resolves (~5s).
      id: 'AMT LSM Maw of the Wolf',
      type: 'StartsUsing',
      netRegex: { id: 'B67B', source: 'Lone Swordmaster', capture: false },
      durationSeconds: 5,
      response: Responses.getBehind(),
    },
    {
      // Collect the 4 Will of the Underworld casters' positions for the current wave.
      id: 'AMT LSM Will of the Underworld Collect',
      type: 'StartsUsing',
      netRegex: { id: 'B69D' },
      run: (data, matches) => {
        data.lsmWillActive = true;
        // FFXIV coords: x = east-west, y = north-south, z = height. Use y for north-south.
        data.lsmWillCasters.push({ x: parseFloat(matches.x), z: parseFloat(matches.y) });
      },
    },
    {
      // During Will of the Underworld, a Malefic Portent tether (directional TetherN/E/S/W)
      // adds one unsafe side = its direction (BossMod uses the last such tether). The side
      // only applies to attacks resolving after tether+7s; with a 4s cast that means waves
      // that cast >3s after the tether. The Will trigger reads this at cast+0.3s, so delay
      // setting it by ~3.3s -- earlier waves stay 2-side (inner), later ones become 3-side.
      // (These tethers are sticky here -- no take/pass.)
      id: 'AMT LSM Will Portent Tether',
      type: 'Tether',
      netRegex: { id: ['0165', '0166', '0167', '0168'] },
      condition: (data, matches) => data.lsmWillActive && data.me === matches.source,
      delaySeconds: 3.3,
      run: (data, matches) => {
        const idToSide: { [id: string]: number } = { '0165': 8, '0166': 1, '0167': 2, '0168': 4 };
        data.lsmPortentTetherSide = idToSide[matches.id] ?? 0;
      },
    },
    {
      // Announce the safe spot per wave. Effective unsafe mask = base Malefic sides, plus
      // the Malefic Portent tether's added side once it has appeared (so pre-tether waves
      // are 2 sides, post-tether are 3). With 3 unsafe (one safe side) there is no safe
      // inner tile -> go to the outer tile on that safe side ("<safe> out"). With a 2-side
      // corner pair -> the inner quadrant, computed from this wave's casters (the tile hit
      // by the vertical attack from the safe N/S side and horizontal from the safe E/W).
      id: 'AMT LSM Will of the Underworld',
      type: 'StartsUsing',
      netRegex: { id: 'B69D', capture: false },
      delaySeconds: 0.3,
      // B69D is a 4s cast; hold the call only until this wave's damage (~3.7s later),
      // which also keeps it clear of the next wave (waves are >=5s apart).
      durationSeconds: 3.7,
      suppressSeconds: 3,
      alertText: (data, _matches, output) => {
        const casters = data.lsmWillCasters;
        data.lsmWillCasters = [];
        // Each position outputs its direction unless the user configured a waymark for it.
        const call = (configId: string, dirKey: string): string => {
          const cfg = data.triggerSetConfig[configId];
          if (typeof cfg === 'string' && cfg !== 'dir')
            return output.waymark!({ mark: cfg });
          return output[dirKey]!();
        };
        const mask = data.lsmMaleficMask | data.lsmPortentTetherSide;
        const safe = 15 & ~mask;
        // Three unsafe sides -> one safe side -> a single outer tile. Which tile is NOT
        // simply "the safe side out": a fixed floor pinwheel (map effect, verified constant
        // across many logged sessions and patches) leaves exactly one safe outer tile per
        // edge, each in a fixed lane -- North edge in the WEST column, South in the EAST
        // column, East in the NORTH row, West in the SOUTH row. The player's safe outer
        // tile is the pinwheel tile guarded by their safe-side caster, so read that caster's
        // lane: a safe N/S caster sits in a column (west -> North, east -> South); a safe
        // E/W caster sits in a row (north -> East, south -> West). This can land on the
        // opposite cardinal from the safe side.
        if (safe === 8 || safe === 4 || safe === 1 || safe === 2) {
          const safeCaster = casters.find((c) => lsmCasterFromSide(c.x, c.z) === safe);
          if (safeCaster === undefined)
            return;
          const [dir, letter] = (safe === 8 || safe === 4)
            ? (safeCaster.x < lsmCenterX ? ['north', 'N'] : ['south', 'S'])
            : (safeCaster.z < lsmCenterZ ? ['east', 'E'] : ['west', 'W']);
          return call(`willMark${letter}`, `${dir}Out`);
        }
        // Two unsafe sides (corner pair) -> inner quadrant.
        const unsafeNS = mask & 12; // N|S
        const unsafeEW = mask & 3; //  E|W
        if ((unsafeNS !== 4 && unsafeNS !== 8) || (unsafeEW !== 1 && unsafeEW !== 2))
          return;
        const safeNS = 12 - unsafeNS; // the other vertical side
        const safeEW = 3 - unsafeEW; //  the other horizontal side
        let row: 'N' | 'S' | undefined;
        let column: 'E' | 'W' | undefined;
        for (const c of casters) {
          const side = lsmCasterFromSide(c.x, c.z);
          if (side === safeNS)
            column = c.x < lsmCenterX ? 'W' : 'E';
          if (side === safeEW)
            row = c.z < lsmCenterZ ? 'N' : 'S';
        }
        if (row === undefined || column === undefined)
          return;
        const quad = `${row}${column}`;
        return call(`willMark${quad}`, quad);
      },
      outputStrings: {
        NW: { en: 'NW', de: 'NW', fr: 'NO', ja: '北西', cn: '西北', ko: '북서' },
        NE: { en: 'NE', de: 'NO', fr: 'NE', ja: '北東', cn: '东北', ko: '북동' },
        SW: { en: 'SW', de: 'SW', fr: 'SO', ja: '南西', cn: '西南', ko: '남서' },
        SE: { en: 'SE', de: 'SO', fr: 'SE', ja: '南東', cn: '东南', ko: '남동' },
        northOut: {
          en: 'North out',
          de: 'Norden raus',
          fr: 'Nord ext.',
          ja: '北の外',
          cn: '北外',
          ko: '북쪽 밖',
        },
        southOut: {
          en: 'South out',
          de: 'Süden raus',
          fr: 'Sud ext.',
          ja: '南の外',
          cn: '南外',
          ko: '남쪽 밖',
        },
        eastOut: {
          en: 'East out',
          de: 'Osten raus',
          fr: 'Est ext.',
          ja: '東の外',
          cn: '东外',
          ko: '동쪽 밖',
        },
        westOut: {
          en: 'West out',
          de: 'Westen raus',
          fr: 'Ouest ext.',
          ja: '西の外',
          cn: '西外',
          ko: '서쪽 밖',
        },
        waymark: { en: '${mark}' },
      },
    },
    {
      // Will of the Underworld (Large): the two Fallen Rock pillars spawn ~50s ahead (around
      // Plummet) and stay for all four waves. Collect their positions (diagonal pair). Only
      // these rocks are named "Fallen Rock" in this phase, so no filtering is needed.
      id: 'AMT LSM Large Will Rocks Collect',
      type: 'AddedCombatant',
      netRegex: { name: 'Fallen Rock' },
      run: (data, matches) => {
        const x = parseFloat(matches.x);
        const z = parseFloat(matches.y);
        if (!data.lsmRocks.some((r) => Math.abs(r.x - x) < 1 && Math.abs(r.z - z) < 1))
          data.lsmRocks.push({ x, z });
      },
    },
    {
      // Collect the four Large Will casters (one per edge) for the current wave.
      id: 'AMT LSM Large Will Collect',
      type: 'StartsUsing',
      netRegex: { id: 'BA93' },
      run: (data, matches) =>
        data.lsmLargeWillCasters.push({ x: parseFloat(matches.x), z: parseFloat(matches.y) }),
    },
    {
      // Resolve each Large Will wave: with 3 unsafe sides the only safe spot is a rock's
      // shadow. lsmLargeWillResolve returns the destination quadrant plus the rock+side to
      // line up behind -- the shadow can reach a DIFFERENT quadrant than the rock, so we lead
      // with the quadrant. Derived from the caster arrangement + fixed rocks + safe side.
      id: 'AMT LSM Large Will',
      type: 'StartsUsing',
      netRegex: { id: 'BA93', capture: false },
      delaySeconds: 0.3,
      durationSeconds: 4.2,
      suppressSeconds: 5,
      alertText: (data, _matches, output) => {
        const casters = data.lsmLargeWillCasters;
        data.lsmLargeWillCasters = [];
        const safe = 15 & ~data.lsmMaleficMask;
        if (safe !== 1 && safe !== 2 && safe !== 4 && safe !== 8)
          return;
        if (casters.length < 4 || data.lsmRocks.length < 2)
          return;
        const res = lsmLargeWillResolve(safe, casters, data.lsmRocks);
        if (res === undefined)
          return;
        return output.behindRock!({ zone: res.zone, dir: output[res.side]!(), rock: res.rock });
      },
      outputStrings: {
        behindRock: {
          en: '${zone}: ${dir} of ${rock} rock',
          de: '${zone}: ${dir} vom ${rock} Fels',
          fr: '${zone} : ${dir} du rocher ${rock}',
          ja: '${zone}: ${rock}の岩の${dir}',
          cn: '${zone}: ${rock}岩石的${dir}',
          ko: '${zone}: ${rock} 바위 ${dir}',
        },
        north: { en: 'North', de: 'Norden', fr: 'Nord', ja: '北', cn: '北', ko: '북' },
        south: { en: 'South', de: 'Süden', fr: 'Sud', ja: '南', cn: '南', ko: '남' },
        east: { en: 'East', de: 'Osten', fr: 'Est', ja: '東', cn: '东', ko: '동' },
        west: { en: 'West', de: 'Westen', fr: 'Ouest', ja: '西', cn: '西', ko: '서' },
      },
    },
  ],
};

export default triggerSet;
