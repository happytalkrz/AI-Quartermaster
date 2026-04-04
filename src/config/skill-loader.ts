import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";
import { SkillContent } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

interface SkillFrontmatter {
  name: string;
  description: string;
}

/**
 * Parse frontmatter from a markdown file.
 * Returns { frontmatter, content } or null if no frontmatter found.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; content: string } | null {
  const lines = content.split('\n');

  // Check if file starts with ---
  if (lines[0]?.trim() !== '---') {
    return null;
  }

  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return null;
  }

  try {
    const yamlContent = lines.slice(1, endIndex).join('\n');
    const frontmatter = parseYaml(yamlContent) as SkillFrontmatter;

    // Validate required fields
    if (typeof frontmatter?.name !== 'string' || typeof frontmatter?.description !== 'string') {
      return null;
    }

    const bodyContent = lines.slice(endIndex + 1).join('\n').trim();
    return { frontmatter, content: bodyContent };
  } catch (error: unknown) {
    return null;
  }
}

/**
 * Load all skills from .claude/skills/{category}/{name}/SKILL.md structure.
 * Returns empty array if skills directory doesn't exist.
 * Skips individual files with errors and logs them.
 */
export function loadSkills(skillsPath: string): SkillContent[] {
  const resolvedPath = resolve(skillsPath);

  try {
    if (!statSync(resolvedPath).isDirectory()) {
      logger.warn(`Skills path is not a directory: ${resolvedPath}`);
      return [];
    }
  } catch (error: unknown) {
    logger.debug(`Skills directory not found: ${resolvedPath}`);
    return [];
  }

  const skills: SkillContent[] = [];

  try {
    const categories = readdirSync(resolvedPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const category of categories) {
      const categoryPath = join(resolvedPath, category);

      try {
        const skillDirs = readdirSync(categoryPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);

        for (const skillName of skillDirs) {
          const skillFilePath = join(categoryPath, skillName, 'SKILL.md');

          try {
            if (!existsSync(skillFilePath)) {
              logger.debug(`SKILL.md not found: ${skillFilePath}`);
              continue;
            }

            const fileContent = readFileSync(skillFilePath, 'utf-8');
            const parsed = parseFrontmatter(fileContent);

            if (!parsed) {
              logger.warn(`Invalid frontmatter in skill file: ${skillFilePath}`);
              continue;
            }

            skills.push({
              name: parsed.frontmatter.name,
              category: category,
              description: parsed.frontmatter.description,
              content: parsed.content,
            });

            logger.debug(`Loaded skill: ${category}/${skillName} (${parsed.frontmatter.name})`);
          } catch (error: unknown) {
            logger.warn(`Error reading skill file ${skillFilePath}:`, error);
            continue;
          }
        }
      } catch (error: unknown) {
        logger.warn(`Error reading category directory ${categoryPath}:`, error);
        continue;
      }
    }

    logger.info(`Loaded ${skills.length} skills from ${resolvedPath}`);
    return skills;
  } catch (error: unknown) {
    logger.error(`Error loading skills from ${resolvedPath}:`, error);
    return [];
  }
}

/**
 * Format loaded skills for prompt injection.
 * Returns markdown formatted text ready for prompt inclusion.
 */
export function formatSkillsForPrompt(skills: SkillContent[]): string {
  if (skills.length === 0) {
    return "";
  }

  const sections: string[] = [];

  // Group skills by category
  const skillsByCategory = new Map<string, SkillContent[]>();
  for (const skill of skills) {
    if (!skillsByCategory.has(skill.category)) {
      skillsByCategory.set(skill.category, []);
    }
    skillsByCategory.get(skill.category)!.push(skill);
  }

  // Generate markdown for each category
  for (const [category, categorySkills] of skillsByCategory.entries()) {
    sections.push(`## ${category}`);
    sections.push('');

    for (const skill of categorySkills) {
      sections.push(`### ${skill.name}`);
      sections.push('');
      sections.push(skill.description);
      sections.push('');

      if (skill.content.trim()) {
        sections.push(skill.content);
        sections.push('');
      }
    }
  }

  return sections.join('\n').trim();
}