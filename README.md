# Bible Hover Obsidian Plugin
> Note: This project is heavily vibe-coded 

Link your bible verses through internal links, Hover over the bible verse links to display the verse in a popover. Click on the link to navigate to the verse.
Add multiple versions and quickly switch between versions. Works fully offline. 

The bible internal links are case-insensitive.
![Demo](./demo.gif)

The project follows BYOB (Bring Your Own Bible) approach. 
If you have your bible in Zefania XML format, you can convert to md using [this python program](https://gist.github.com/npc203/565e32a68dcf190976d621b098614486). Else, follow the below format.

## Setup
1. Create bible markdowns in the following format.
```markdown
# Genesis
## Chapter 1
1. In the beginning God created the heavens and the earth.
2. Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the
...
...

## Chapter 2
1. Thus the heavens and the earth were completed in all their vast array.
2. By the seventh day God had finished the work he had been doing; so on the seventh day he rested from all his work.
3. And God blessed the sevent....
```
2. Place the bible md files inside your vault.
3. Under the bible-hover plugin settings, add your bibles.
