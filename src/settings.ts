import { App, PluginSettingTab, Setting, SuggestModal, Modal } from 'obsidian';
import type BibleHoverPlugin from './main';
import { BOOK_ALIASES } from './bookAliases';

interface BibleVersion {
    name: string;  // e.g., "NIV", "ESV", "KJV"
    path: string;  // e.g., "NIV.md"
}

export interface BibleHoverSettings {
    bibles: BibleVersion[];
    defaultBible: string; // Name of the default version
    linkColor: string;
}

export const DEFAULT_SETTINGS: BibleHoverSettings = {
    bibles: [],
    defaultBible: '',
    linkColor: '#ff4d4d'
}

export class BibleHoverSettingTab extends PluginSettingTab {
	plugin: BibleHoverPlugin;

	constructor(app: App, plugin: BibleHoverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		;

		new Setting(containerEl)
			.setName('Bible Versions')
			.setDesc('Add and manage Bible versions (markdown files).')
			.addButton(button => button
				.setButtonText('Add Bible Version')
				.onClick(() => {
					new AddBibleModal(this.app, async (name, path) => {
						this.plugin.settings.bibles.push({ name, path });
						if (!this.plugin.settings.defaultBible) {
							this.plugin.settings.defaultBible = name;
						}
						await this.plugin.saveSettings();
						await this.plugin.loadBibleData();
						this.display();
					}).open();
				}))
			.addButton(button => button
				.setButtonText('Re-index All')
				.setWarning()
				.onClick(async () => {
					await this.plugin.loadBibleData();
					// Show feedback
					const btn = button.buttonEl;
					const originalText = btn.textContent;
					btn.textContent = 'Indexed!';
					setTimeout(() => {
						btn.textContent = originalText;
					}, 2000);
				}));

		// Default Version Selection
		if (this.plugin.settings.bibles.length > 0) {
			new Setting(containerEl)
				.setName('Default Bible')
				.setDesc('Select the default version to show in hovers.')
				.addDropdown(dropdown => {
					this.plugin.settings.bibles.forEach(bible => {
						dropdown.addOption(bible.name, bible.name);
					});
					dropdown.setValue(this.plugin.settings.defaultBible);
					dropdown.onChange(async (value) => {
						this.plugin.settings.defaultBible = value;
						await this.plugin.saveSettings();
						await this.plugin.loadBibleData();
					});
				});
		}

		new Setting(containerEl)
			.setName('Link Color')
			.setDesc('Customize the color of the Bible links.')
			.addColorPicker(color => color
				.setValue(this.plugin.settings.linkColor)
				.onChange(async (value) => {
					this.plugin.settings.linkColor = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				}));

		// List of configured versions
		new Setting(containerEl).setName("Configured Bibles").setHeading();
		const biblesContainer = containerEl.createDiv({ cls: 'bibles-list-container' });

		this.plugin.settings.bibles.forEach((bible, index) => {
			const bibleEl = biblesContainer.createDiv({ cls: 'setting-item' });
			bibleEl.style.backgroundColor = 'var(--background-secondary)';
			bibleEl.style.padding = '15px';
			bibleEl.style.borderRadius = '8px';
			bibleEl.style.marginBottom = '10px';

			const info = bibleEl.createDiv({ cls: 'setting-item-info' });
			info.createDiv({ cls: 'setting-item-name', text: bible.name });
			info.createDiv({ cls: 'setting-item-description', text: bible.path });

			const controls = bibleEl.createDiv({ cls: 'setting-item-control' });

			const deleteBtn = controls.createEl('button', { text: 'Delete', cls: 'mod-warning' });
			deleteBtn.addEventListener('click', async () => {
				this.plugin.settings.bibles.splice(index, 1);
				if (this.plugin.settings.defaultBible === bible.name) {
					this.plugin.settings.defaultBible = this.plugin.settings.bibles.length > 0 ? this.plugin.settings.bibles[0].name : '';
				}
				await this.plugin.saveSettings();
				await this.plugin.loadBibleData();
				this.display();
			});
		});

		// Add a note showing supported book names
		new Setting(containerEl).setName("Supported Book Names & Aliases").setHeading();
		const noteEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		noteEl.style.marginTop = '10px';
		noteEl.style.fontSize = '0.9em';
		noteEl.style.lineHeight = '1.6';

		// Generate book list dynamically from parser aliases
		const bookMap = new Map<string, string[]>();

		BOOK_ALIASES.forEach((bookName: string, alias: string) => {
			if (!bookMap.has(bookName)) {
				bookMap.set(bookName, []);
			}
			if (alias.toLowerCase() !== bookName.toLowerCase()) {
				bookMap.get(bookName)!.push(alias.charAt(0).toUpperCase() + alias.slice(1));
			}
		});

		const bookList: string[] = [];
		const uniqueBooks = Array.from(new Set(BOOK_ALIASES.values()));

		uniqueBooks.forEach((bookName: string) => {
			const aliases = bookMap.get(bookName) || [];
			if (aliases.length > 0) {
				bookList.push(`${bookName} (${aliases.join(', ')})`);
			} else {
				bookList.push(bookName);
			}
		});

		noteEl.innerHTML = bookList.join('<br>');
	}
}


class FileSelectModal extends SuggestModal<string> {
    files: string[];
    onSelect: (path: string) => void;

    constructor(app: App, files: string[], onSelect: (path: string) => void) {
        super(app);
        this.files = files;
        this.onSelect = onSelect;
    }

    getSuggestions(query: string): string[] {
        return this.files.filter(file =>
            file.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(file: string, el: HTMLElement): void {
        el.createEl('div', { text: file });
    }

    onChooseSuggestion(file: string, evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(file);
    }
}

class AddBibleModal extends Modal {
    name: string = '';
    path: string = '';
    onSave: (name: string, path: string) => void;

    constructor(app: App, onSave: (name: string, path: string) => void) {
        super(app);
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add Bible Version' });

        new Setting(contentEl)
            .setName('Version Name')
            .setDesc('e.g. NIV, ESV, KJV')
            .addText(text => text
                .setPlaceholder('NIV')
                .onChange(value => this.name = value));

        new Setting(contentEl)
            .setName('File Path')
            .setDesc('Path to the markdown file')
            .addText(text => {
                text.setPlaceholder('path/to/bible.md');
                text.setValue(this.path);
                text.onChange(value => this.path = value);
            })
            .addButton(btn => btn
                .setButtonText('Browse')
                .onClick(() => {
                    const files = this.app.vault.getMarkdownFiles().map(f => f.path);
                    new FileSelectModal(this.app, files, (selectedPath) => {
                        this.path = selectedPath;
                        this.onOpen(); // Refresh modal to show selected path
                    }).open();
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    if (this.name && this.path) {
                        this.onSave(this.name, this.path);
                        this.close();
                    }
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
