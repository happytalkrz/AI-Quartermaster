import type { HooksConfig, HookTiming, HookDefinition } from "../types/hooks.js";

export class HookRegistry {
  private config: HooksConfig;

  constructor(config: HooksConfig = {}) {
    this.config = config;
  }

  getHooks(timing: HookTiming): HookDefinition[] {
    return this.config[timing] || [];
  }

  hasHooks(timing: HookTiming): boolean {
    return (this.config[timing]?.length ?? 0) > 0;
  }

  getAllTimings(): HookTiming[] {
    return Object.entries(this.config)
      .filter(([, hooks]) => hooks && hooks.length > 0)
      .map(([timing]) => timing as HookTiming);
  }

  updateConfig(newConfig: HooksConfig, merge = false): void {
    if (merge) {
      this.config = { ...this.config, ...newConfig };
    } else {
      this.config = newConfig;
    }
  }

  getHookCount(): number {
    return Object.values(this.config).reduce(
      (total, hooks) => total + (hooks?.length || 0),
      0
    );
  }
}