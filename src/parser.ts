export interface BibleVerse {
    verse: number;
    text: string;
    line: number; // 0-indexed line number in source file
}

export interface BibleChapter {
    number: number;
    verses: Map<number, BibleVerse>;
}

export interface BibleBook {
    name: string;
    chapters: Map<number, BibleChapter>;
}

export class BibleParser {
    books: Map<string, BibleBook> = new Map();

    // Static alias map for common abbreviations
    static aliases: Map<string, string> = new Map([
        ['gen', 'Genesis'],
        ['exo', 'Exodus'],
        ['ex', 'Exodus'],
        ['lev', 'Leviticus'],
        ['num', 'Numbers'],
        ['deu', 'Deuteronomy'],
        ['josh', 'Joshua'],
        ['judg', 'Judges'],
        ['ruth', 'Ruth'],
        ['1 sam', '1 Samuel'],
        ['2 sam', '2 Samuel'],
        ['1 ki', '1 Kings'],
        ['2 ki', '2 Kings'],
        ['1 chron', '1 Chronicles'],
        ['2 chron', '2 Chronicles'],
        ['ezra', 'Ezra'],
        ['neh', 'Nehemiah'],
        ['est', 'Esther'],
        ['job', 'Job'],
        ['psa', 'Psalms'],
        ['pro', 'Proverbs'],
        ['prov', 'Proverbs'],
        ['ecc', 'Ecclesiastes'],
        ['song', 'Song of Solomon'],
        ['isa', 'Isaiah'],
        ['jer', 'Jeremiah'],
        ['lam', 'Lamentations'],
        ['eze', 'Ezekiel'],
        ['dan', 'Daniel'],
        ['hos', 'Hosea'],
        ['joel', 'Joel'],
        ['amos', 'Amos'],
        ['obad', 'Obadiah'],
        ['jon', 'Jonah'],
        ['mic', 'Micah'],
        ['nah', 'Nahum'],
        ['hab', 'Habakkuk'],
        ['zeph', 'Zephaniah'],
        ['hag', 'Haggai'],
        ['zec', 'Zechariah'], // Corrected abbreviation
        ['zech', 'Zechariah'],
        ['mal', 'Malachi'],
        ['matt', 'Matthew'],
        ['mark', 'Mark'],
        ['luke', 'Luke'],
        ['john', 'John'],
        ['acts', 'Acts'],
        ['rom', 'Romans'],
        ['1 cor', '1 Corinthians'],
        ['2 cor', '2 Corinthians'],
        ['gal', 'Galatians'],
        ['eph', 'Ephesians'],
        ['phil', 'Philippians'],
        ['col', 'Colossians'],
        ['1 thess', '1 Thessalonians'],
        ['2 thess', '2 Thessalonians'],
        ['1 tim', '1 Timothy'],
        ['2 tim', '2 Timothy'],
        ['titus', 'Titus'],
        ['philem', 'Philemon'],
        ['heb', 'Hebrews'],
        ['james', 'James'],
        ['1 pet', '1 Peter'],
        ['2 pet', '2 Peter'],
        ['1 john', '1 John'],
        ['2 john', '2 John'],
        ['3 john', '3 John'],
        ['jude', 'Jude'],
        ['rev', 'Revelation']
    ]);

    constructor(markdownContent: string) {
        this.parse(markdownContent);
    }

    private parse(content: string) {
        const lines = content.split('\n');
        let currentBook: BibleBook | null = null;
        let currentChapter: BibleChapter | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const bookMatch = line.match(/^# (.+)/);
            if (bookMatch && bookMatch[1]) {
                const bookName = bookMatch[1].trim();
                // Store using Lowercase Key
                const key = bookName.toLowerCase();

                currentBook = { name: bookName, chapters: new Map() };
                this.books.set(key, currentBook);
                currentChapter = null;
                continue;
            }

            const chapterMatch = line.match(/^## Chapter (\d+)/);
            if (chapterMatch && chapterMatch[1] && currentBook) {
                const chapterNum = parseInt(chapterMatch[1]);
                currentChapter = { number: chapterNum, verses: new Map() };
                currentBook.chapters.set(chapterNum, currentChapter);
                continue;
            }

            const verseMatch = line.match(/^(\d+)\. (.+)/);
            if (verseMatch && verseMatch[1] && verseMatch[2] && currentChapter) {
                const verseNum = parseInt(verseMatch[1]);
                const verseText = verseMatch[2].trim();
                currentChapter.verses.set(verseNum, {
                    verse: verseNum,
                    text: verseText,
                    line: i
                });
            }
        }
    }

    public getVerses(refString: string): string | null {
        const parts = this.parseRef(refString);
        if (!parts) return null;

        const { bookName, chapterNum, startVerse, endVerse } = parts;

        // Resolve Alias (Case Insensitive)
        let searchKey = bookName.toLowerCase();

        // Check alias map
        if (BibleParser.aliases.has(searchKey)) {
            // Get proper name, but we store in map by lowercase key of the proper name
            const properName = BibleParser.aliases.get(searchKey)!;
            searchKey = properName.toLowerCase();
        }

        const book = this.books.get(searchKey);
        if (!book) return null;

        const chapter = book.chapters.get(chapterNum);
        if (!chapter) return null;

        let output = `**${book.name} ${chapterNum}:${startVerse}${startVerse !== endVerse ? '-' + endVerse : ''}**\n\n`;

        for (let i = startVerse; i <= endVerse; i++) {
            const verseData = chapter.verses.get(i);
            if (verseData) {
                output += `<sup>${i}</sup> ${verseData.text} `;
            }
        }

        return output.trim();
    }

    public getVerseLine(refString: string): number | null {
        const parts = this.parseRef(refString);
        if (!parts) return null;

        const { bookName, chapterNum, startVerse } = parts;

        let searchKey = bookName.toLowerCase();
        if (BibleParser.aliases.has(searchKey)) {
            const properName = BibleParser.aliases.get(searchKey)!;
            searchKey = properName.toLowerCase();
        }

        const book = this.books.get(searchKey);
        if (!book) return null;

        const chapter = book.chapters.get(chapterNum);
        if (!chapter) return null;

        const verseData = chapter.verses.get(startVerse);
        if (!verseData) return null;

        return verseData.line;
    }

    private parseRef(refString: string) {
        const cleanRef = refString.replace(/\[\[|\]\]/g, '');
        // Case insensitive regex matching not needed if we are just extracting
        // but the input string itself might have different casing. 
        // Logic remains same: extract parts, convert name to lower.

        const parts = cleanRef.match(/(.+?)\s(\d+):(\d+)(?:-(\d+))?/);

        if (!parts || !parts[1] || !parts[2] || !parts[3]) return null;

        return {
            bookName: parts[1].trim(),
            chapterNum: parseInt(parts[2]),
            startVerse: parseInt(parts[3]),
            endVerse: parts[4] ? parseInt(parts[4]) : parseInt(parts[3])
        };
    }
}
