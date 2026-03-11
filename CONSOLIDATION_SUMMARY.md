# RaidKeep Code Consolidation Summary

## New Shared Modules

### Utils
- **`client/src/utils/classColors.ts`** — `CLASS_COLORS`, `getClassColor` (WoW class hex colors)
- **`client/src/utils/realm.ts`** — `capitalizeRealm`, `toRealmSlug`
- **`client/src/utils/guildApi.ts`** — `guildQueryString`, `guildQueryStringFromSlug`, `guildRealmQueryString`

### Hooks
- **`client/src/hooks/useGuildParams.ts`** — Returns `{ realm, guildName, serverType, realmSlug, isValid }` from URL search params

### Constants
- **`client/src/constants/raid.ts`** — `RAID_ROLES`, `DAYS`, `DEFAULT_AVAILABILITY`

### Types
- **`client/src/types/raid.ts`** — `RaiderEntry`, `RaidTeam`

### Exports from Existing Files
- **`GuildPermissions.tsx`** — Exported `DEFAULT_PERMISSIONS` for reuse

---

## Files Updated

| File | Changes |
|------|---------|
| RaidCard.tsx | Import `getClassColor` from classColors |
| Dashboard.tsx | Import `getClassColor`, `capitalizeRealm` |
| GuildDashboard.tsx | useGuildParams, guildQueryStringFromSlug, DEFAULT_PERMISSIONS, capitalizeRealm |
| GuildLoading.tsx | useGuildParams, guildQueryStringFromSlug, guildRealmQueryString, capitalizeRealm |
| GuildPermissions.tsx | capitalizeRealm, useGuildParams, guildQueryStringFromSlug, export DEFAULT_PERMISSIONS |
| GuildCrafters.tsx | getClassColor, capitalizeRealm, useGuildParams, guildQueryStringFromSlug |
| GuildRoster.tsx | getClassColor, capitalizeRealm, useGuildParams, guildQueryStringFromSlug |
| RaidSchedule.tsx | DEFAULT_PERMISSIONS, capitalizeRealm, useGuildParams, guildQueryStringFromSlug, guildRealmQueryString |
| RaidRoster.tsx | DEFAULT_PERMISSIONS, getClassColor, capitalizeRealm, useGuildParams, guildQueryStringFromSlug, guildRealmQueryString, RaiderEntry, RaidTeam, RAID_ROLES, DAYS, DEFAULT_AVAILABILITY |
| RaidRosterPopout.tsx | Same as RaidRoster |
| RaidView.tsx | getClassColor, capitalizeRealm |
| PlanRaid.tsx | DEFAULT_PERMISSIONS, getClassColor, capitalizeRealm, useGuildParams, guildQueryStringFromSlug |
| AdminGuildDetail.tsx | capitalizeRealm |

---

## Duplication Removed

- **8 copies** of `CLASS_COLORS` + `getClassColor` → 1 shared module
- **9+ copies** of `capitalizeRealm` → 1 shared module
- **8 copies** of realm/guild params parsing → `useGuildParams` hook
- **5 copies** of `DEFAULT_PERMISSIONS` → 1 export from GuildPermissions
- **2 copies** of `RAID_ROLES`, `DAYS`, `DEFAULT_AVAILABILITY` → shared constants
- **2 copies** of `RaiderEntry`, `RaidTeam` → shared types
- **10+ copies** of guild query string building → `guildQueryStringFromSlug`, `guildRealmQueryString`

---

## Build & Tests

- **Build:** ✓ Success
- **Tests:** 19 passing
