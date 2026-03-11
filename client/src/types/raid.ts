export interface RaiderEntry {
  character_name: string;
  character_class: string;
  primary_spec?: string;
  off_spec?: string;
  secondary_spec?: string;
  notes?: string;
  officer_notes?: string;
  notes_public?: boolean;
  raid_role?: string;
  raid_lead?: boolean;
  raid_assist?: boolean;
  availability?: string;
}

export interface RaidTeam {
  id: number;
  team_name: string;
  members: Array<{ character_name: string; character_class: string }>;
}
