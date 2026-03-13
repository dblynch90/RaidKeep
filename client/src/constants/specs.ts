/** Spec entry: display label (with role) and stored value (spec name only) */
export type SpecOption = { label: string; value: string };

/** Retail: current WoW specs */
const RETAIL_SPECS: Record<string, SpecOption[]> = {
  Warrior: [
    { label: "Arms", value: "Arms" },
    { label: "Fury", value: "Fury" },
    { label: "Protection", value: "Protection" },
  ],
  Paladin: [
    { label: "Holy", value: "Holy" },
    { label: "Protection", value: "Protection" },
    { label: "Retribution", value: "Retribution" },
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
    { label: "Discipline", value: "Discipline" },
    { label: "Holy", value: "Holy" },
    { label: "Shadow", value: "Shadow" },
  ],
  "Death Knight": [
    { label: "Blood", value: "Blood" },
    { label: "Frost", value: "Frost" },
    { label: "Unholy", value: "Unholy" },
  ],
  Shaman: [
    { label: "Elemental", value: "Elemental" },
    { label: "Enhancement", value: "Enhancement" },
    { label: "Restoration", value: "Restoration" },
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
    { label: "Brewmaster", value: "Brewmaster" },
    { label: "Mistweaver", value: "Mistweaver" },
    { label: "Windwalker", value: "Windwalker" },
  ],
  Druid: [
    { label: "Balance", value: "Balance" },
    { label: "Feral", value: "Feral" },
    { label: "Guardian", value: "Guardian" },
    { label: "Restoration", value: "Restoration" },
  ],
  "Demon Hunter": [
    { label: "Havoc", value: "Havoc" },
    { label: "Vengeance", value: "Vengeance" },
  ],
  Evoker: [
    { label: "Augmentation", value: "Augmentation" },
    { label: "Devastation", value: "Devastation" },
    { label: "Preservation", value: "Preservation" },
  ],
};

/** TBC Classic: classes and specs available in TBC. No DK, Monk, DH, Evoker. Rogue uses Combat. Druid has Feral (cat+bear). */
const TBC_SPECS: Record<string, SpecOption[]> = {
  Warrior: [
    { label: "Arms", value: "Arms" },
    { label: "Fury", value: "Fury" },
    { label: "Protection", value: "Protection" },
  ],
  Paladin: [
    { label: "Holy", value: "Holy" },
    { label: "Protection", value: "Protection" },
    { label: "Retribution", value: "Retribution" },
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
    { label: "Discipline", value: "Discipline" },
    { label: "Holy", value: "Holy" },
    { label: "Shadow", value: "Shadow" },
  ],
  Shaman: [
    { label: "Elemental", value: "Elemental" },
    { label: "Enhancement", value: "Enhancement" },
    { label: "Restoration", value: "Restoration" },
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
    { label: "Balance", value: "Balance" },
    { label: "Feral", value: "Feral" },
    { label: "Restoration", value: "Restoration" },
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
