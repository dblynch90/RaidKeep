# RaidKeep Export Addon

Export your guild roster from WoW (TBC Classic / TBC Anniversary) for import into [RaidKeep](https://raidkeep.app).

## Installation

1. Copy the `RaidKeepExport` folder into your WoW `Interface\AddOns` directory:
   - **TBC Classic / TBC Anniversary**: `World of Warcraft\_classic_era_\Interface\AddOns\` or `World of Warcraft\_classic_\Interface\AddOns\` (depending on your client)
   - The full path should be: `...\Interface\AddOns\RaidKeepExport\`

2. Restart WoW or reload your UI (`/reload`)

## Usage

1. Log in with a character that is in a guild
2. Type `/raidkeep` or `/rk` to open the export window
3. **Open your Guild panel (G)** first if the roster is empty, then click **Fetch Roster**
4. Click **Fetch Roster** to export your guild roster
5. The JSON appears in the box below – Ctrl+A, Ctrl+C to copy
6. Go to [RaidKeep](https://raidkeep.app) → Dashboard → **Import from addon export**
7. Select your region (US, EU, etc.) and paste the JSON
8. Click **Import roster**

## Requirements

- You must be in a guild
- Addon is built for **TBC Classic / TBC Anniversary** (Interface 20504)

## Troubleshooting

- **"Out of date"**: The addon uses Interface 20505 for TBC Anniversary.
- **"You must be in a guild"**: Log in with a character that has guild membership
- **Empty roster**: Open your Guild panel (G) first, wait for the roster to load, then try `/rk` again
- **Invalid JSON when importing**: Ensure you copied the entire output, including the opening `{` and closing `}`
