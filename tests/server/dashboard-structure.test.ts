import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HTML_PATH = resolve(__dirname, "../../src/server/public/index.html");

describe("dashboard HTML structure (regression guard for index.html refactor)", () => {
  let html: string;

  beforeAll(() => {
    html = readFileSync(HTML_PATH, "utf-8");
  });

  describe("view panels", () => {
    const views = [
      "view-dashboard",
      "view-logs",
      "view-repositories",
      "view-automations",
      "view-settings",
    ] as const;

    for (const viewId of views) {
      it(`should contain #${viewId} panel`, () => {
        expect(html).toContain(`id="${viewId}"`);
      });
    }

    it("should mark view panels with view-panel class", () => {
      const matches = html.match(/class="[^"]*view-panel[^"]*"/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("sidebar navigation", () => {
    const navItems = [
      "dashboard",
      "logs",
      "repositories",
      "automations",
      "settings",
    ] as const;

    it("should contain sidebar-nav element", () => {
      expect(html).toContain('id="sidebar-nav"');
    });

    for (const nav of navItems) {
      it(`should contain sidebar nav item for ${nav}`, () => {
        expect(html).toContain(`data-nav="${nav}"`);
      });
    }

    it("should have exactly 5 sidebar nav items inside sidebar-nav", () => {
      const sidebarNavStart = html.indexOf('id="sidebar-nav"');
      expect(sidebarNavStart).toBeGreaterThan(-1);

      // Extract the sidebar-nav block by finding the closing </nav>
      const sidebarSection = html.slice(sidebarNavStart);
      const navClose = sidebarSection.indexOf("</nav>");
      const sidebarContent = sidebarSection.slice(0, navClose);

      const matches = sidebarContent.match(/data-nav="/g) ?? [];
      expect(matches.length).toBe(5);
    });
  });

  describe("header", () => {
    it("should contain a header element", () => {
      expect(html).toMatch(/<header[\s>]/);
    });
  });

  describe("modals", () => {
    it("should contain confirm-modal", () => {
      expect(html).toContain('id="confirm-modal"');
    });

    it("should contain timeline-modal-root", () => {
      expect(html).toContain('id="timeline-modal-root"');
    });
  });

  describe("page identity", () => {
    it("should have html-root id on html element", () => {
      expect(html).toContain('id="html-root"');
    });

    it("should have AQM page title", () => {
      expect(html).toContain("AI Quartermaster");
    });
  });
});
