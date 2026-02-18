/**
 * Plugin Settings Tab
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type FlywheelCrankPlugin from './main';
import type { FlywheelCrankSettings } from './core/types';

export class FlywheelCrankSettingTab extends PluginSettingTab {
  plugin: FlywheelCrankPlugin;

  constructor(app: App, plugin: FlywheelCrankPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Flywheel Crank' });
    containerEl.createEl('p', {
      text: 'Graph intelligence & semantic search for your vault.',
      cls: 'setting-item-description',
    });

    // Feature toggles
    containerEl.createEl('h3', { text: 'Features' });

    new Setting(containerEl)
      .setName('Full-text search')
      .setDesc('Enable FTS5 full-text search with BM25 ranking')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSearch)
        .onChange(async (value) => {
          this.plugin.settings.enableSearch = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Graph sidebar')
      .setDesc('Show backlinks, forward links, and related notes for the active note')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableGraphSidebar)
        .onChange(async (value) => {
          this.plugin.settings.enableGraphSidebar = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Wikilink suggestions')
      .setDesc('Suggest entities when typing [[')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableWikilinkSuggest)
        .onChange(async (value) => {
          this.plugin.settings.enableWikilinkSuggest = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Entity browser')
      .setDesc('Browse all vault entities grouped by category')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableEntityBrowser)
        .onChange(async (value) => {
          this.plugin.settings.enableEntityBrowser = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Vault health')
      .setDesc('Show orphan notes, dead links, and vault diagnostics')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableVaultHealth)
        .onChange(async (value) => {
          this.plugin.settings.enableVaultHealth = value;
          await this.plugin.saveSettings();
        })
      );

    // Search settings
    containerEl.createEl('h3', { text: 'Search' });

    new Setting(containerEl)
      .setName('Max search results')
      .setDesc('Maximum number of search results to show')
      .addSlider(slider => slider
        .setLimits(5, 50, 5)
        .setValue(this.plugin.settings.maxSearchResults)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSearchResults = value;
          await this.plugin.saveSettings();
        })
      );

    // MCP Server
    containerEl.createEl('h3', { text: 'MCP Server' });

    new Setting(containerEl)
      .setName('Server path')
      .setDesc('Path to flywheel-memory server entry point. Leave empty to use npx @velvetmonkey/flywheel-memory (recommended). Set a local path for development.')
      .addText(text => text
        .setPlaceholder('npx @velvetmonkey/flywheel-memory')
        .setValue(this.plugin.settings.mcpServerPath)
        .onChange(async (value) => {
          this.plugin.settings.mcpServerPath = value.trim();
          await this.plugin.saveSettings();
        })
      );

    // Indexing
    containerEl.createEl('h3', { text: 'Indexing' });

    new Setting(containerEl)
      .setName('Exclude folders')
      .setDesc('Folders to exclude from entity scanning (comma-separated)')
      .addTextArea(text => text
        .setPlaceholder('daily-notes, templates, attachments')
        .setValue(this.plugin.settings.excludeFolders.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = value
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          await this.plugin.saveSettings();
        })
      );

    // Analysis
    containerEl.createEl('h3', { text: 'Analysis' });

    const excludeTagsSetting = new Setting(containerEl)
      .setName('Exclude tags from analysis')
      .setDesc('Notes with these tags are filtered from hub rankings and semantic link suggestions (comma-separated). Recurring tags like "habit" and "daily" are auto-detected on startup.');

    // Load current value from MCP server, fall back to empty
    if (this.plugin.mcpClient.connected) {
      excludeTagsSetting.addTextArea(text => {
        text.setPlaceholder('habit, daily, recurring');
        text.inputEl.rows = 2;

        // Load async
        this.plugin.mcpClient.getFlywheelConfig().then(cfg => {
          const tags = cfg.exclude_analysis_tags ?? [];
          text.setValue(tags.join(', '));
        }).catch(() => {
          text.setPlaceholder('(connect to server to load)');
        });

        text.onChange(async (value) => {
          const tags = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
          try {
            await this.plugin.mcpClient.setFlywheelConfig('exclude_analysis_tags', tags);
          } catch (err) {
            console.error('Flywheel Crank: failed to save exclude_analysis_tags', err);
          }
        });

        return text;
      });
    } else {
      excludeTagsSetting.setDesc('Connect to MCP server to configure. ' + excludeTagsSetting.descEl.textContent);
    }
  }
}
