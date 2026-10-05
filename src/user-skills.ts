export interface SkillFile { path: string; content: string }
export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  files: SkillFile[];
  format: 'agent-skill' | 'markdown';
}
export interface UserSkill extends SkillDraft {
  id: string;
  enabled: boolean;
  signature: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface UserSkillSnapshot { id: string; name: string; signature: string; revision: number }
export const SKILL_LIMITS = { files: 64, uploadBytes: 2 * 1024 * 1024, fileBytes: 64 * 1024, packageCharacters: 48_000, enabled: 4, contextCharacters: 64_000, installed: 30 } as const;
