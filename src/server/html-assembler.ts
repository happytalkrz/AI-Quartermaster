import { readFileSync } from "fs";
import { resolve } from "path";

const LAYOUT_ORDER = [
  "_layout-head.html",
  "_layout-header.html",
  "_layout-sidebar.html",
  "dashboard.html",
  "logs.html",
  "repositories.html",
  "automations.html",
  "new-issue.html",
  "settings.html",
  "_layout-footer.html",
] as const;

export function assembleHtml(publicDir: string): string {
  const viewsDir = resolve(publicDir, "views");
  return LAYOUT_ORDER.map((file) =>
    readFileSync(resolve(viewsDir, file), "utf-8")
  ).join("\n");
}
