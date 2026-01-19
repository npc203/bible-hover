import { Plugin, MarkdownRenderer, TFile } from 'obsidian';
import { BibleParser } from './parser';
import {DEFAULT_SETTINGS, BibleHoverSettings, BibleHoverSettingTab} from "./settings";
import { bibleObserver } from './editor';
import { BOOK_ALIASES } from './bookAliases';

export default class BibleHoverPlugin extends Plugin {
    bibleParsers: Map<string, BibleParser> = new Map();
    validBookNames: Set<string> = new Set();
    currentVersion: string = '';
    hoverPopover: HTMLElement | null = null;
    hideTimeout: NodeJS.Timeout | null = null;
    settings: BibleHoverSettings;

    async onload() {
        // Preprocess book aliases into a flattened set for fast lookup
        this.initializeBookNames();

        await this.loadSettings();
        this.applySettings();

        this.app.workspace.onLayoutReady(async () => {
            await this.loadBibleData();
        });

        this.addSettingTab(new BibleHoverSettingTab(this.app, this));

        this.registerEditorExtension(bibleObserver);

        // Command to re-index all bibles
        this.addCommand({
            id: 'reindex-bibles',
            name: 'Re-index all Bibles',
            callback: async () => {
                await this.loadBibleData();
            }
        });

        // Global Event Listener for Hover
        this.registerDomEvent(document, 'mouseover', (evt: MouseEvent) => {
            const linkEl = this.getLinkElement(evt.target as HTMLElement);
            if (linkEl) {
                const ref = this.getRefFromLink(linkEl);
                if (ref) {
                    this.onLinkHover(evt, ref);
                    return;
                }
            }
            this.handleLinkNotFound(evt);
        });

        // Touch support for hover popover
        this.registerDomEvent(document, 'touchstart', (evt: TouchEvent) => {
            const linkEl = this.getLinkElement(evt.target as HTMLElement);
            if (linkEl) {
                const ref = this.getRefFromLink(linkEl);
                if (ref) {
                    const touch = evt.touches[0];
                    this.onLinkHover(touch as unknown, ref);
                    return;
                }
            }
            this.handleLinkNotFound(evt);
        });

        // Global Event Listener for Click (Navigation)
        this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
            const linkEl = this.getLinkElement(evt.target as HTMLElement);
            if (linkEl) {
                const ref = this.getRefFromLink(linkEl);
                if (ref) {
                    await this.navigateToVerse(evt, ref);
                    return;
                }
            }
            this.handleLinkNotFound(evt);
        }, { capture: true });

        // Touch support for navigation (tap on link)
        this.registerDomEvent(document, 'touchend', async (evt: TouchEvent) => {
            const linkEl = this.getLinkElement(evt.target as HTMLElement);
            if (linkEl) {
                const ref = this.getRefFromLink(linkEl);
                if (ref) {
                    await this.navigateToVerse(evt, ref);
                    return;
                }
            }
            this.handleLinkNotFound(evt);
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
        // Match pattern: "Book Name chapter:verse"
        const match = text.match(/^(.+?)\s+(\d+):(\d+)/);
        if (!match || !match[1]) return false;

        const bookName = match[1].toLowerCase();
        return this.validBookNames.has(bookName);
    }

    private initializeBookNames(): void {
        // Flatten all book aliases and full names into a Set for O(1) lookup
        BOOK_ALIASES.forEach((fullName, alias) => {
            this.validBookNames.add(alias.toLowerCase());
            this.validBookNames.add(fullName.toLowerCase());
        });
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
            }

            // Set current version to default or first available
            if (this.settings.defaultBible && this.bibleParsers.has(this.settings.defaultBible)) {
                this.currentVersion = this.settings.defaultBible;
            } else if (this.bibleParsers.size > 0) {
                const firstVersion = Array.from(this.bibleParsers.keys())[0];
                if(firstVersion)
                this.currentVersion = firstVersion;
            }
        } catch (e) {
            console.error('Error loading bible data', e);
        }
    }

    applySettings() {
        // Create or update a style element to inject CSS variables
        // This is to change link colors dynamically
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

    private getLinkElement(target: HTMLElement): HTMLElement | null {
        return target.matches('.bible-link') ? target : target.closest('.bible-link');
    }

    private getRefFromLink(linkEl: HTMLElement): string | null {
        let ref = linkEl.getAttribute('data-href');
        if (!ref) ref = linkEl.textContent;
        if (!ref) return null;
        
        ref = ref.replace(/\[\[|\]\]/g, '');
        return this.isBibleRef(ref) ? ref : null;
    }

    private handleLinkFound(event: MouseEvent | TouchEvent, ref: string, callback: (ref: string) => void): void {
        callback(ref);
    }

    private handleLinkNotFound(event: MouseEvent | TouchEvent): void {
        if (this.hoverPopover && !(event.target as HTMLElement).closest('.bible-hover-popover')) {
            this.onLinkLeave(event as MouseEvent);
        }
    }

    async onLinkHover(event: MouseEvent, ref: string) {
        const parser = this.getCurrentParser();
        if (!parser) return;
        const text = parser.getVerses(ref);

        if (this.hoverPopover) this.hoverPopover.remove();

        this.hoverPopover = document.createElement('div');
        this.hoverPopover.addClass('bible-hover-popover');

        // Position closer to the link
        let top = event.clientY + 5;
        let left = event.clientX + 5; 

        if (left + 300 > window.innerWidth) left = window.innerWidth - 320;
        if (top + 300 > window.innerHeight) top = event.clientY - 310;

        this.hoverPopover.style.top = top + 'px';
        this.hoverPopover.style.left = left + 'px';

        const renderContent = async (textToRender: string | null, contentDiv: HTMLElement) => {
            contentDiv.empty();
            const content = textToRender || 'Not found';
            await MarkdownRenderer.render(this.app, content, contentDiv, '', this);
        };

        // Add version header if any bible loaded
        if (this.bibleParsers.size > 0) {
            const header = this.hoverPopover.createDiv({ cls: 'bible-popover-header' });

            const leftSide = header.createDiv({ cls: 'bible-popover-left-side' });
            leftSide.createSpan({ text: 'Version: ' });

            if (this.bibleParsers.size > 1) {
                const select = leftSide.createEl('select');
                select.addClass('bible-popover-select');

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
                        await renderContent(newText, contentDiv);
                    }
                });

                setDefaultBtn.addEventListener('click', async () => {
                    this.settings.defaultBible = this.currentVersion;
                    await this.saveSettings();
                    setDefaultBtn.setText('Saved!');
                    setTimeout(() => {
                        setDefaultBtn.setText('Set Default');
                        setDefaultBtn.style.display = 'none';
                    }, 1000);
                });
            } else {
                // Just show version name as text if only one
                leftSide.createSpan({ text: this.currentVersion, cls: 'bible-version-tag' });
            }
        }

        const contentDiv = this.hoverPopover.createDiv({ cls: 'bible-popover-content' });
        await renderContent(text, contentDiv);

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

    private async navigateToVerse(evt: MouseEvent | TouchEvent, ref: string): Promise<void> {
        const parser = this.getCurrentParser();
        if (!parser) return;

        evt.preventDefault();
        evt.stopPropagation();

        const line = parser.getVerseLine(ref);
        if (line === null) return;

        // Get path for current version
        const currentBible = this.settings.bibles.find(b => b.name === this.currentVersion);
        if (!currentBible) return;

        const path = currentBible.path;
        const file = this.app.vault.getAbstractFileByPath(path);

        if (file instanceof TFile) {
            // Check for modifiers (Ctrl/Cmd) on mouse events
            const isMouseEvent = evt instanceof MouseEvent;
            const newLeaf = isMouseEvent && (evt.ctrlKey || evt.metaKey);
            const leaf = this.app.workspace.getLeaf(newLeaf);
            await leaf.openFile(file, { eState: { line: line } });
        }
    }
}
