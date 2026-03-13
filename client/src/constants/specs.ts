/** Spec entry: display label (with role) and stored value (spec name only) */
export type SpecOption = { label: string; value: string };

/** Retail: current WoW specs with hybrid role labels where useful */
const RETAIL_SPECS: Record<string, SpecOption[]> = {
  Warrior: [
    { label: "Arms (DPS)", value: "Arms" },
    { label: "Fury (DPS)", value: "Fury" },
    { label: "Protection (Tank)", value: "Protection" },
  ],
  Paladin: [
    { label: "Holy (Heal)", value: "Holy" },
    { label: "Protection (Tank)", value: "Protection" },
    { label: "Retribution (DPS)", value: "Retribution" },
  ],
  Hunter: [
    { label: "Beast Mastery", value: "Beast Mastery" },
    { label: "Marksmanship", value: "Marksmanship" },
    { label: "Survival", value: "Survival" },
  ],
  Rogue: [
    { label: "Assassination", value: "Assassination" },
    { label: "Outlaw", value: "Outlaw" },
    { label: "Subtlety", value: "Subtlety" },
  ],
  Priest: [
    { label: "Discipline (Heal)", value: "Discipline" },
    { label: "Holy (Heal)", value: "Holy" },
    { label: "Shadow (DPS)", value: "Shadow" },
  ],
  "Death Knight": [
    { label: "Blood (Tank)", value: "Blood" },
    { label: "Frost (DPS)", value: "Frost" },
    { label: "Unholy (DPS)", value: "Unholy" },
  ],
  Shaman: [
    { label: "Elemental (DPS)", value: "Elemental" },
    { label: "Enhancement (DPS)", value: "Enhancement" },
    { label: "Restoration (Heal)", value: "Restoration" },
  ],
  Mage: [
    { label: "Arcane", value: "Arcane" },
    { label: "Fire", value: "Fire" },
    { label: "Frost", value: "Frost" },
  ],
  Warlock: [
    { label: "Affliction", value: "Affliction" },
    { label: "Demonology", value: "Demonology" },
    { label: "Destruction", value: "Destruction" },
  ],
  Monk: [
    { label: "Brewmaster (Tank)", value: "Brewmaster" },
    { label: "Mistweaver (Heal)", value: "Mistweaver" },
    { label: "Windwalker (DPS)", value: "Windwalker" },
  ],
  Druid: [
    { label: "Balance (DPS)", value: "Balance" },
    { label: "Feral (DPS)", value: "Feral" },
    { label: "Guardian (Tank)", value: "Guardian" },
    { label: "Restoration (Heal)", value: "Restoration" },
  ],
  "Demon Hunter": [
    { label: "Havoc (DPS)", value: "Havoc" },
    { label: "Vengeance (Tank)", value: "Vengeance" },
  ],
  Evoker: [
    { label: "Augmentation (DPS)", value: "Augmentation" },
    { label: "Devastation (DPS)", value: "Devastation" },
    { label: "Preservation (Heal)", value: "Preservation" },
  ],
};

/** TBC Classic: classes and specs available in TBC. No DK, Monk, DH, Evoker. Rogue uses Combat. Druid has Feral (cat+bear). */
const TBC_SPECS: Record<string, SpecOption[]> = {
  Warrior: [
    { label: "Arms (DPS)", value: "Arms" },
    { label: "Fury (DPS)", value: "Fury" },
    { label: "Protection (Tank)", value: "Protection" },
  ],
  Paladin: [
    { label: "Holy (Heal)", value: "Holy" },
    { label: "Protection (Tank)", value: "Protection" },
    { label: "Retribution (DPS)", value: "Retribution" },
  ],
  Hunter: [
    { label: "Beast Mastery", value: "Beast Mastery" },
    { label: "Marksmanship", value: "Marksmanship" },
    { label: "Survival", value: "Survival" },
  ],
  Rogue: [
    { label: "Assassination", value: "Assassination" },
    { label: "Combat", value: "Combat" },
    { label: "Subtlety", value: "Subtlety" },
  ],
  Priest: [
    { label: "Discipline (Heal)", value: "Discipline" },
    { label: "Holy (Heal)", value: "Holy" },
    { label: "Shadow (DPS)", value: "Shadow" },
  ],
  Shaman: [
    { label: "Elemental (DPS)", value: "Elemental" },
    { label: "Enhancement (DPS)", value: "Enhancement" },
    { label: "Restoration (Heal)", value: "Restoration" },
  ],
  Mage: [
    { label: "Arcane", value: "Arcane" },
    { label: "Fire", value: "Fire" },
    { label: "Frost", value: "Frost" },
  ],
  Warlock: [
    { label: "Affliction", value: "Affliction" },
    { label: "Demonology", value: "Demonology" },
    { label: "Destruction", value: "Destruction" },
  ],
  Druid: [
    { label: "Balance (DPS)", value: "Balance" },
    { label: "Feral (Tank/DPS)", value: "Feral" },
    { label: "Restoration (Heal)", value: "Restoration" },
  ],
};

/** Map serverType to spec set. Default to Retail for unknown. */
function getSpecMap(serverType: string): Record<string, SpecOption[]> {
  const tbc = ["TBC Anniversary", "TBC", "TBC Classic", "Classic"].includes(serverType);
  return tbc ? TBC_SPECS : RETAIL_SPECS;
}

/** Find class key (case-insensitive) */
function findClassKey(className: string, specMap: Record<string, SpecOption[]>): string | undefined {
  const lower = className.toLowerCase();
  return Object.keys(specMap).find((k) => k.toLowerCase() === lower);
}

/**
 * Get specs for a class, filtered by game version.
 * @param className - Character class
 * @param serverType - "Retail" or "TBC Anniversary" etc.
 * @param currentValue - Existing stored value (included if not in list, for legacy/custom)
 * @returns Spec options { label, value }
 */
export function getSpecsForClass(
  className: string,
  currentValue?: string,
  serverType?: string
): SpecOption[] {
  const specMap = getSpecMap(serverType ?? "Retail");
  const key = findClassKey(className, specMap);
  const specs = key ? specMap[key] : [];
  if (!currentValue?.trim()) return specs;
  const normalized = currentValue.trim();
  if (specs.some((s) => s.value.toLowerCase() === normalized.toLowerCase())) return specs;
  return [{ label: normalized, value: normalized }, ...specs];
}
