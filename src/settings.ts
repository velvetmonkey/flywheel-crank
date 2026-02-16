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

    // Exclude folders
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
  }
}
