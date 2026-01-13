import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, TFile, SuggestModal, Modal } from 'obsidian';
import { BibleParser } from './parser';
import { bibleObserver } from './editor';

interface BibleVersion {
    name: string;  // e.g., "NIV", "ESV", "KJV"
    path: string;  // e.g., "NIV.md"
}

interface BibleHoverSettings {
    bibles: BibleVersion[];
    defaultBible: string; // Name of the default version
    linkColor: string;
}

const DEFAULT_SETTINGS: BibleHoverSettings = {
    bibles: [],
    defaultBible: '',
    linkColor: '#ff4d4d'
}

export default class BibleHoverPlugin extends Plugin {
    bibleParsers: Map<string, BibleParser> = new Map();
    currentVersion: string = '';
    hoverPopover: HTMLElement | null = null;
    hideTimeout: NodeJS.Timeout | null = null;
    settings: BibleHoverSettings;

    async onload() {
        console.log('Loading Bible Hover Plugin');

        await this.loadSettings();
        this.applySettings();

        this.app.workspace.onLayoutReady(async () => {
            await this.loadBibleData();
        });

        this.addSettingTab(new BibleHoverSettingTab(this.app, this));

        this.registerEditorExtension(bibleObserver);

        // Global Event Listener for Hover
        this.registerDomEvent(document, 'mouseover', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const linkEl = target.matches('.bible-link') ? target : target.closest('.bible-link');

            if (linkEl) {
                let ref = linkEl.getAttribute('data-href');
                if (!ref) ref = linkEl.textContent;

                if (ref) {
                    ref = ref.replace(/\[\[|\]\]/g, '');
                    if (this.isBibleRef(ref)) {
                        this.onLinkHover(evt, ref);
                        return;
                    }
                }
            } else {
                if (this.hoverPopover && !target.closest('.bible-hover-popover')) {
                    this.onLinkLeave(evt);
                }
            }
        });

        // Global Event Listener for Click (Navigation)
        this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const linkEl = target.matches('.bible-link') ? target : target.closest('.bible-link');

            if (linkEl) {
                let ref = linkEl.getAttribute('data-href');
                if (!ref) ref = linkEl.textContent;

                if (ref) {
                    ref = ref.replace(/\[\[|\]\]/g, '');
                    const parser = this.getCurrentParser();
                    if (this.isBibleRef(ref) && parser) {
                        evt.preventDefault();
                        evt.stopPropagation();

                        const line = parser.getVerseLine(ref);
                        if (line !== null) {
                            // Get path for current version
                            const currentBible = this.settings.bibles.find(b => b.name === this.currentVersion);
                            if (!currentBible) return;

                            const path = currentBible.path;
                            const file = this.app.vault.getAbstractFileByPath(path);

                            if (file instanceof TFile) {
                                // Check for modifiers (Ctrl/Cmd)
                                const newLeaf = evt.ctrlKey || evt.metaKey;
                                const leaf = this.app.workspace.getLeaf(newLeaf);
                                await leaf.openFile(file, { eState: { line: line } });
                            }
                        }
                    }
                }
            }
        }, { capture: true });

        this.registerMarkdownPostProcessor((element, context) => {
            const links = element.querySelectorAll('a.internal-link');
            links.forEach((link) => {
                const linkEl = link as HTMLAnchorElement;
                const href = linkEl.getAttribute('data-href');

                if (href && this.isBibleRef(href)) {
                    linkEl.addClass('bible-link');
                }
            });
        });
    }

    async onunload() {
        if (this.hoverPopover) {
            this.hoverPopover.remove();
        }
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    isBibleRef(text: string): boolean {
        return /.+ \d+:\d+/.test(text); // Regex is already loose, but let's ensure it handles case if we add specific book checks later. Current check doesn't care about case.
    }

    async loadBibleData() {
        try {
            const adapter = this.app.vault.adapter;
            this.bibleParsers.clear();

            if (this.settings.bibles.length === 0) {
                console.log('No Bibles configured');
                return;
            }

            // Load all configured Bibles
            for (const bible of this.settings.bibles) {
                let path = bible.path;

                // Ensure usage of correct path if user didn't provide extension
                if (!path.endsWith('.md')) path += '.md';

                if (!(await adapter.exists(path))) {
                    console.log(`Bible file not found at ${path}`);
                    continue;
                }

                const content = await adapter.read(path);
                this.bibleParsers.set(bible.name, new BibleParser(content));
                console.log(`Bible data loaded: ${bible.name} from ${path}`);
            }

            // Set current version to default or first available
            if (this.settings.defaultBible && this.bibleParsers.has(this.settings.defaultBible)) {
                this.currentVersion = this.settings.defaultBible;
            } else if (this.bibleParsers.size > 0) {
                this.currentVersion = Array.from(this.bibleParsers.keys())[0];
            }

            console.log(`Current version: ${this.currentVersion}`);
        } catch (e) {
            console.error('Error loading bible data', e);
        }
    }

    applySettings() {
        // Create or update a style element to inject CSS variables
        let styleEl = document.getElementById('bible-hover-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'bible-hover-styles';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            :root {
                --bible-link-color: ${this.settings.linkColor};
            }
        `;
    }

    getCurrentParser(): BibleParser | null {
        if (!this.currentVersion) return null;
        return this.bibleParsers.get(this.currentVersion) || null;
    }

    async onLinkHover(event: MouseEvent, ref: string) {
        const parser = this.getCurrentParser();
        if (!parser) return;
        const text = parser.getVerses(ref);
        if (!text) return;

        if (this.hoverPopover) this.hoverPopover.remove();

        this.hoverPopover = document.createElement('div');
        this.hoverPopover.addClass('bible-hover-popover');
        this.hoverPopover.style.position = 'fixed';

        // Position closer to the link
        let top = event.clientY + 5;  // Reduced from 15 to 5
        let left = event.clientX + 5; // Added small offset

        if (left + 300 > window.innerWidth) left = window.innerWidth - 320;
        if (top + 300 > window.innerHeight) top = event.clientY - 310;

        this.hoverPopover.style.top = top + 'px';
        this.hoverPopover.style.left = left + 'px';
        this.hoverPopover.style.zIndex = '9999';
        this.hoverPopover.style.backgroundColor = 'var(--background-primary)';
        this.hoverPopover.style.border = '1px solid var(--background-modifier-border)';
        this.hoverPopover.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        this.hoverPopover.style.borderRadius = '6px';
        this.hoverPopover.style.maxHeight = '300px';
        this.hoverPopover.style.overflowY = 'auto';

        // Add version header if any bible loaded
        if (this.bibleParsers.size > 0) {
            const header = this.hoverPopover.createDiv({ cls: 'bible-popover-header' });
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.padding = '6px 12px';
            header.style.borderBottom = '1px solid var(--background-modifier-border)';
            header.style.backgroundColor = 'var(--background-secondary)';
            header.style.fontSize = '0.85em';
            header.style.gap = '8px';
            header.style.flexShrink = '0'; // Ensure header doesn't shrink

            const leftSide = header.createDiv();
            leftSide.style.display = 'flex';
            leftSide.style.alignItems = 'center';
            leftSide.style.gap = '6px';
            leftSide.createSpan({ text: 'Version: ' });

            if (this.bibleParsers.size > 1) {
                const select = leftSide.createEl('select');
                select.style.fontSize = 'inherit';
                select.style.padding = '2px 4px';
                select.style.backgroundColor = 'var(--background-primary)';
                select.style.color = 'var(--text-normal)';
                select.style.border = '1px solid var(--background-modifier-border)';
                select.style.borderRadius = '4px';
                select.style.cursor = 'pointer';

                Array.from(this.bibleParsers.keys()).forEach(version => {
                    const option = select.createEl('option', { text: version, value: version });
                    if (version === this.currentVersion) option.selected = true;
                });

                const setDefaultBtn = header.createEl('button', {
                    text: 'Set Default',
                    cls: 'mod-cta'
                });
                setDefaultBtn.style.fontSize = '0.75em';
                setDefaultBtn.style.padding = '2px 8px';
                setDefaultBtn.style.height = 'auto';

                // Only show if it's not already default
                setDefaultBtn.style.display = this.currentVersion === this.settings.defaultBible ? 'none' : 'block';

                select.addEventListener('change', async () => {
                    this.currentVersion = select.value;
                    setDefaultBtn.style.display = this.currentVersion === this.settings.defaultBible ? 'none' : 'block';

                    const newParser = this.getCurrentParser();
                    if (newParser) {
                        const newText = newParser.getVerses(ref);
                        if (newText) {
                            contentDiv.empty();
                            await MarkdownRenderer.render(this.app, newText, contentDiv, '', this);
                        }
                    }
                });

                setDefaultBtn.addEventListener('click', async () => {
                    this.settings.defaultBible = this.currentVersion;
                    await this.saveSettings();
                    setDefaultBtn.style.display = 'none';
                    setDefaultBtn.setText('Saved!');
                    setTimeout(() => setDefaultBtn.setText('Set Default'), 1000);
                });
            } else {
                // Just show version name as text if only one
                leftSide.createSpan({ text: this.currentVersion, cls: 'bible-version-tag' });
            }
        }

        const contentDiv = this.hoverPopover.createDiv({ cls: 'bible-popover-content' });
        contentDiv.style.padding = '8px';
        await MarkdownRenderer.render(this.app, text, contentDiv, '', this);

        // Keep popover visible when mouse is over it
        this.hoverPopover.addEventListener('mouseenter', () => {
            // Clear the hide timeout when entering popover
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
            if (this.hoverPopover) {
                this.hoverPopover.dataset.hovering = 'true';
            }
        });

        this.hoverPopover.addEventListener('mouseleave', () => {
            if (this.hoverPopover) {
                this.hoverPopover.dataset.hovering = 'false';
                this.hoverPopover.remove();
                this.hoverPopover = null;
            }
        });

        document.body.appendChild(this.hoverPopover);
    }

    onLinkLeave(event: MouseEvent) {
        // Clear any existing timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        // Add delay before hiding (300ms)
        this.hideTimeout = setTimeout(() => {
            // Don't remove if mouse is over the popover
            if (this.hoverPopover && this.hoverPopover.dataset.hovering !== 'true') {
                this.hoverPopover.remove();
                this.hoverPopover = null;
            }
        }, 300);
    }
}

class BibleHoverSettingTab extends PluginSettingTab {
    plugin: BibleHoverPlugin;

    constructor(app: App, plugin: BibleHoverPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Bible Hover Settings' });

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
        containerEl.createEl('h3', { text: 'Configured Bibles' });
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
        containerEl.createEl('h3', { text: 'Supported Book Names & Aliases' });
        const noteEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        noteEl.style.marginTop = '10px';
        noteEl.style.fontSize = '0.9em';
        noteEl.style.lineHeight = '1.6';

        // Generate book list dynamically from parser aliases
        const bookMap = new Map<string, string[]>();

        BibleParser.aliases.forEach((bookName: string, alias: string) => {
            if (!bookMap.has(bookName)) {
                bookMap.set(bookName, []);
            }
            if (alias.toLowerCase() !== bookName.toLowerCase()) {
                bookMap.get(bookName)!.push(alias.charAt(0).toUpperCase() + alias.slice(1));
            }
        });

        const bookList: string[] = [];
        const uniqueBooks = Array.from(new Set(BibleParser.aliases.values()));

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

        const pathSetting = new Setting(contentEl)
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
