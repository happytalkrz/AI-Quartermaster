import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadSkills, formatSkillsForPrompt } from '../../src/config/skill-loader.js';

describe('skill-loader', () => {
  const testDir = resolve('./test-temp-skills');

  beforeEach(() => {
    // Clean up any existing test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadSkills', () => {
    it('should return empty array when skills directory does not exist', () => {
      const result = loadSkills('./non-existent-directory');
      expect(result).toEqual([]);
    });

    it('should return empty array when skills path is not a directory', () => {
      // Create a file instead of directory
      writeFileSync(testDir, 'not a directory');

      const result = loadSkills(testDir);
      expect(result).toEqual([]);
    });

    it('should load valid skills with frontmatter', () => {
      // Create test skills structure
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'test-skill'), { recursive: true });

      const skillContent = `---
name: "Test Skill"
description: "A test skill for development"
---

This is the main content of the skill.

## Usage

Use this skill for testing purposes.`;

      writeFileSync(join(testDir, 'dev', 'test-skill', 'SKILL.md'), skillContent);

      const result = loadSkills(testDir);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'Test Skill',
        category: 'dev',
        description: 'A test skill for development',
        content: 'This is the main content of the skill.\n\n## Usage\n\nUse this skill for testing purposes.',
      });
    });

    it('should skip skills without SKILL.md file', () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'no-skill-file'), { recursive: true });
      // No SKILL.md file created

      const result = loadSkills(testDir);
      expect(result).toEqual([]);
    });

    it('should skip skills with invalid frontmatter', () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'invalid-skill'), { recursive: true });

      // Invalid frontmatter (missing required fields)
      const invalidContent = `---
title: "Missing required fields"
---

Content here.`;

      writeFileSync(join(testDir, 'dev', 'invalid-skill', 'SKILL.md'), invalidContent);

      const result = loadSkills(testDir);
      expect(result).toEqual([]);
    });

    it('should skip skills without frontmatter', () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'no-frontmatter'), { recursive: true });

      const noFrontmatterContent = `# This is just markdown

No frontmatter here.`;

      writeFileSync(join(testDir, 'dev', 'no-frontmatter', 'SKILL.md'), noFrontmatterContent);

      const result = loadSkills(testDir);
      expect(result).toEqual([]);
    });

    it('should load multiple skills from multiple categories', () => {
      mkdirSync(testDir, { recursive: true });

      // Category 1: dev
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'skill1'), { recursive: true });
      writeFileSync(join(testDir, 'dev', 'skill1', 'SKILL.md'), `---
name: "Dev Skill 1"
description: "First dev skill"
---

Dev skill content 1.`);

      // Category 2: ops
      mkdirSync(join(testDir, 'ops'), { recursive: true });
      mkdirSync(join(testDir, 'ops', 'skill2'), { recursive: true });
      writeFileSync(join(testDir, 'ops', 'skill2', 'SKILL.md'), `---
name: "Ops Skill 2"
description: "First ops skill"
---

Ops skill content 2.`);

      const result = loadSkills(testDir);

      expect(result).toHaveLength(2);
      expect(result.find(s => s.category === 'dev')).toBeDefined();
      expect(result.find(s => s.category === 'ops')).toBeDefined();
    });

    it('should handle malformed YAML gracefully', () => {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'dev'), { recursive: true });
      mkdirSync(join(testDir, 'dev', 'malformed'), { recursive: true });

      const malformedContent = `---
name: "Malformed YAML
description: unclosed quote
---

Content.`;

      writeFileSync(join(testDir, 'dev', 'malformed', 'SKILL.md'), malformedContent);

      const result = loadSkills(testDir);
      expect(result).toEqual([]);
    });
  });

  describe('formatSkillsForPrompt', () => {
    it('should return empty string for empty skills array', () => {
      const result = formatSkillsForPrompt([]);
      expect(result).toBe('');
    });

    it('should format single skill correctly', () => {
      const skills = [{
        name: 'Test Skill',
        category: 'dev',
        description: 'A test skill',
        content: 'Skill content here.',
      }];

      const result = formatSkillsForPrompt(skills);
      const expected = `## dev

### Test Skill

A test skill

Skill content here.`;

      expect(result).toBe(expected);
    });

    it('should format multiple skills grouped by category', () => {
      const skills = [
        {
          name: 'Skill 1',
          category: 'dev',
          description: 'First dev skill',
          content: 'Dev content 1.',
        },
        {
          name: 'Skill 2',
          category: 'ops',
          description: 'First ops skill',
          content: 'Ops content 2.',
        },
        {
          name: 'Skill 3',
          category: 'dev',
          description: 'Second dev skill',
          content: 'Dev content 3.',
        },
      ];

      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('## dev');
      expect(result).toContain('## ops');
      expect(result).toContain('### Skill 1');
      expect(result).toContain('### Skill 2');
      expect(result).toContain('### Skill 3');
    });

    it('should handle skills with empty content', () => {
      const skills = [{
        name: 'Empty Skill',
        category: 'test',
        description: 'Skill with no content',
        content: '',
      }];

      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('## test');
      expect(result).toContain('### Empty Skill');
      expect(result).toContain('Skill with no content');
      expect(result).not.toContain('Skill with no content\n\n\n'); // No extra newlines for empty content
    });
  });
});