import { watch, FSWatcher, existsSync } from "fs";
import { resolve } from "path";
import { EventEmitter } from "events";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface ConfigChangeEvent {
  type: 'base' | 'local' | 'both';
  paths: string[];
}

export class ConfigWatcher extends EventEmitter {
  private projectRoot: string;
  private baseConfigPath: string;
  private localConfigPath: string;
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();

  constructor(projectRoot: string) {
    super();
    this.projectRoot = resolve(projectRoot);
    this.baseConfigPath = resolve(this.projectRoot, "config.yml");
    this.localConfigPath = resolve(this.projectRoot, "config.local.yml");
  }

  startWatching(): void {
    this.stopWatching(); // Ensure clean state

    // Watch base config.yml (required)
    this.watchFile(this.baseConfigPath, 'base');

    // Watch local config.local.yml if it exists
    if (existsSync(this.localConfigPath)) {
      this.watchFile(this.localConfigPath, 'local');
    }

    // Also watch the project directory to catch creation of config.local.yml
    this.watchDirectory();

    logger.info(`Started watching config files in: ${this.projectRoot}`);
  }

  stopWatching(): void {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close all watchers
    for (const [path, watcher] of this.watchers.entries()) {
      try {
        watcher.close();
        logger.debug(`Stopped watching: ${path}`);
      } catch (err) {
        logger.warn(`Error closing watcher for ${path}: ${err}`);
      }
    }
    this.watchers.clear();
    this.pendingChanges.clear();

    logger.info('Stopped watching config files');
  }

  private watchFile(filePath: string, type: 'base' | 'local'): void {
    try {
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        this.handleFileEvent(filePath, type, eventType);
      });

      this.watchers.set(filePath, watcher);
      logger.debug(`Started watching file: ${filePath}`);
    } catch (err) {
      logger.error(`Failed to watch file ${filePath}: ${err}`);
    }
  }

  private watchDirectory(): void {
    try {
      const watcher = watch(this.projectRoot, { persistent: false }, (eventType, filename) => {
        if (filename === 'config.local.yml') {
          this.handleDirectoryEvent(eventType, filename);
        }
      });

      this.watchers.set(this.projectRoot, watcher);
      logger.debug(`Started watching directory: ${this.projectRoot}`);
    } catch (err) {
      logger.error(`Failed to watch directory ${this.projectRoot}: ${err}`);
    }
  }

  private handleFileEvent(filePath: string, type: 'base' | 'local', eventType: string): void {
    logger.debug(`Config file event: ${eventType} on ${filePath}`);

    // Add to pending changes
    this.pendingChanges.add(type);

    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer (100ms like JobStore)
    this.debounceTimer = setTimeout(() => {
      this.emitConfigChanged();
      this.debounceTimer = null;
    }, 100);
  }

  private handleDirectoryEvent(eventType: string, filename: string): void {
    if (filename !== 'config.local.yml') return;

    const localPath = this.localConfigPath;
    const exists = existsSync(localPath);

    logger.debug(`Directory event: ${eventType} for ${filename}, exists: ${exists}`);

    if (exists && !this.watchers.has(localPath)) {
      // config.local.yml was created, start watching it
      this.watchFile(localPath, 'local');
      this.pendingChanges.add('local');
    } else if (!exists && this.watchers.has(localPath)) {
      // config.local.yml was deleted, stop watching it
      const watcher = this.watchers.get(localPath);
      if (watcher) {
        watcher.close();
        this.watchers.delete(localPath);
      }
      this.pendingChanges.add('local');
    }

    // Trigger debounced config change if there are pending changes
    if (this.pendingChanges.size > 0) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.emitConfigChanged();
        this.debounceTimer = null;
      }, 100);
    }
  }

  private emitConfigChanged(): void {
    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    if (changes.length === 0) return;

    // Determine event type based on what changed
    let eventType: 'base' | 'local' | 'both';
    const paths: string[] = [];

    const hasBase = changes.includes('base');
    const hasLocal = changes.includes('local');

    if (hasBase && hasLocal) {
      eventType = 'both';
      paths.push(this.baseConfigPath, this.localConfigPath);
    } else if (hasBase) {
      eventType = 'base';
      paths.push(this.baseConfigPath);
    } else {
      eventType = 'local';
      paths.push(this.localConfigPath);
    }

    const event: ConfigChangeEvent = {
      type: eventType,
      paths
    };

    logger.info(`Config changed: ${eventType} (${paths.join(', ')})`);
    this.emit('configChanged', event);
  }
}