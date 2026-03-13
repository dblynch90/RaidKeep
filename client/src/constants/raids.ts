/** Raid instances available per game version */

const TBC_RAIDS = [
  "Karazhan (10)",
  "Gruul's Lair (25)",
  "Magtheridon's Lair (25)",
  "Serpentshrine Cavern (25)",
  "Tempest Keep (25)",
  "Hyjal (25)",
  "Black Temple (25)",
  "Sunwell Plateau (25)",
  "Zul'Aman (10)",
  "Other",
];

const RETAIL_RAIDS = [
  "Amirdrassil (25)",
  "Aberrus (25)",
  "Vault of the Incarnates (25)",
  "Sepulcher of the First Ones (25)",
  "Sanctum of Domination (25)",
  "Castle Nathria (25)",
  "Ny'alotha (25)",
  "Eternal Palace (25)",
  "Battle of Dazar'alor (25)",
  "Uldir (25)",
  "Antorus (25)",
  "Tomb of Sargeras (25)",
  "Nighthold (25)",
  "Emerald Nightmare (25)",
  "Karazhan (10)",
  "Other",
];

/** Map serverType to raid list. Default to Retail for unknown. */
export function getRaidsForVersion(serverType: string): string[] {
  const tbc = ["TBC Anniversary", "TBC", "TBC Classic", "Classic"].includes(serverType);
  return tbc ? TBC_RAIDS : RETAIL_RAIDS;
}
