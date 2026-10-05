export const SKILLS_CHANGED = 'ai-tip:user-skills-changed';
export function notifySkillChange() { window.dispatchEvent(new Event(SKILLS_CHANGED)); }
