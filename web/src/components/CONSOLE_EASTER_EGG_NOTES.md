# Console Easter Egg - Known Issues & Notes

## Goal
Display an animated ASCII ship in the browser console with:
- **Brown ship** (#92400e)
- **Purple "Dream it. Ship it." text** (#a855f7 - PlexMCP brand color)
- **Blue animated waves** (#0ea5e9)
- **All in ONE console block** (not multiple numbered entries)
- **Continuous wave animation** (loops forever)

## Current Status: BROKEN
The ship keeps disappearing. The multi-color `%c` approach within a single `console.log` is unreliable.

## What Works
1. **Single color, one block**: Ship + waves in one `console.log` with one color = works perfectly
2. **Multiple colors, multiple blocks**: Separate `console.log` calls for ship/text/waves = works but creates ugly numbered blocks

## What Doesn't Work
- Multiple `%c` markers in a single `console.log` with template literals containing backslashes
- The backslash escaping in the ASCII ship art conflicts with the `%c` parsing

## Root Cause (Suspected)
The ship ASCII art contains many backslashes (`\`) which need escaping (`\\`). When combined with `%c` color markers in a template literal, something breaks in Chrome's console parser.

## Versions Tried
1. **v1**: Green ship, blue waves, 2 console.logs - WORKED but had gap
2. **v2**: Added "Dream it. Ship it." + continuous animation - WORKED
3. **v3**: Tried brown/purple/blue with multiple %c in one block - BROKE
4. **v4**: Simplified to all brown, one block - WORKED
5. **v5**: Back to multi-color in one block with template literal - BROKE

## Working Fallback Code
If you need something that works NOW, use this single-color version:

```typescript
"use client";

import { useEffect } from "react";

const SHIP = `          |    |    |
         )_)  )_)  )_)     Dream it.
        )___))___))___)\\\\    Ship it.
       )____)____)_____)\\\\\\\\
     _____|____|____|____\\\\\\\\\\\\__
----\\\\                   /------`;

const WAVES = [
  "  ~~~^~^~^~^~^~^~^~^~^~^~^~^~~~",
  "  ^~^~~~^~^~^~^~^~^~^~^~^~~~^~^",
  "  ~^~^~^~~~^~^~^~^~^~^~~~^~^~^~",
  "  ^~^~^~^~^~~~^~^~^~~~^~^~^~^~^",
  "  ~^~^~^~^~^~^~~~^~^~^~^~^~^~^~",
];

const style = "color: #92400e; font-weight: bold; font-size: 12px; font-family: monospace;";

let animationRunning = false;

export function ConsoleEasterEgg() {
  useEffect(() => {
    if (animationRunning) return;
    if (typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem("__ship") === "1") return;
        sessionStorage.setItem("__ship", "1");
      } catch {}
    }
    animationRunning = true;
    let frame = 0;
    const animate = () => {
      console.clear();
      console.log("%c" + SHIP + "\n" + WAVES[frame % WAVES.length], style);
      frame++;
    };
    animate();
    setInterval(animate, 200);
  }, []);
  return null;
}
```

## Future Solutions to Try
1. Use Canvas API to draw in console (more complex)
2. Use ANSI escape codes (may not work in Chrome)
3. Build ship line-by-line without backslashes (redesign ASCII art)
4. Accept 2-3 blocks and style them nicely
5. Research how Vercel actually does their Dreamship

## Files
- Component: `src/components/console-easter-egg.tsx`
- Imported in: `src/app/layout.tsx`

## Session Storage Keys Used
`__ship`, `__ship2`, `__ship3`, `__ship4`, `__ship5`, `__ship6`, `__ship7`, `__ship8`

Clear all with: `Object.keys(sessionStorage).filter(k => k.startsWith('__ship')).forEach(k => sessionStorage.removeItem(k))`
