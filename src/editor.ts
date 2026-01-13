import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// Simple Regex for "Gen 1:1" or "[[Gen 1:1]]"
// We want to highlight the text inside [[ ]] if it matches the pattern.
const BIBLE_REF_REGEX = /\[\[(.+? \d+:\d+(?:-\d+)?)\]\]/gi;

export const bibleObserver = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();

            for (const { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                let match;

                // Reset regex
                BIBLE_REF_REGEX.lastIndex = 0;

                while ((match = BIBLE_REF_REGEX.exec(text)) !== null) {
                    const start = from + match.index + 2; // Skip [[
                    const end = start + match[1].length;  // Length of inner content

                    // Add mark decoration to the inner part
                    builder.add(
                        start,
                        end,
                        Decoration.mark({
                            class: "bible-link"
                        })
                    );
                }
            }

            return builder.finish();
        }
    },
    {
        decorations: (v) => v.decorations,
    }
);