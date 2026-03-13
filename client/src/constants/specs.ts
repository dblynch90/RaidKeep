/** WoW class to spec mapping. Specs available per class for dropdowns. */
export const CLASS_SPECS: Record<string, string[]> = {
  Warrior: ["Arms", "Fury", "Protection"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Rogue: ["Assassination", "Outlaw", "Subtlety"],
  Priest: ["Discipline", "Holy", "Shadow"],
  "Death Knight": ["Blood", "Frost", "Unholy"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Mage: ["Arcane", "Fire", "Frost"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Monk: ["Brewmaster", "Mistweaver", "Windwalker"],
  Druid: ["Balance", "Feral", "Guardian", "Restoration"],
  "Demon Hunter": ["Havoc", "Vengeance"],
  Evoker: ["Augmentation", "Devastation", "Preservation"],
};

/** Find class key (case-insensitive) */
function findClassKey(className: string): string | undefined {
  const lower = className.toLowerCase();
  return Object.keys(CLASS_SPECS).find((k) => k.toLowerCase() === lower);
}

/** Get specs for a class. Returns empty array if class unknown. Includes current value if not in list (for legacy/custom). */
export function getSpecsForClass(className: string, currentValue?: string): string[] {
  const key = findClassKey(className);
  const specs = key ? CLASS_SPECS[key] : [];
  if (!currentValue?.trim()) return specs;
  const normalized = currentValue.trim();
  if (specs.some((s) => s.toLowerCase() === normalized.toLowerCase())) return specs;
  return [normalized, ...specs];
}
