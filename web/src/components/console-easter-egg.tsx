"use client";

import { useEffect } from "react";

// Wave animation frames
const WAVES = [
  "  ~~~^~^~^~^~^~^~^~^~^~^~^~^~~~",
  "  ^~^~~~^~^~^~^~^~^~^~^~^~~~^~^",
  "  ~^~^~^~~~^~^~^~^~^~^~~~^~^~^~",
  "  ^~^~^~^~^~~~^~^~^~~~^~^~^~^~^",
  "  ~^~^~^~^~^~^~~~^~^~^~^~^~^~^~",
];

// Styles
const SHIP = "color: #92400e; font-weight: bold; font-size: 12px; font-family: monospace;";
const TEXT = "color: #a855f7; font-weight: bold; font-size: 12px; font-family: monospace;";
const WAVE = "color: #0ea5e9; font-weight: bold; font-size: 12px; font-family: monospace;";

let animationRunning = false;

export function ConsoleEasterEgg() {
  useEffect(() => {
    if (animationRunning) return;

    if (typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem("__ship12") === "1") return;
        sessionStorage.setItem("__ship12", "1");
      } catch {}
    }

    animationRunning = true;
    let frame = 0;

    const animate = () => {
      console.clear();

      // Single console.log with all parts - use %c for each color segment
      // Format: %c<ship>%c<text>%c<ship>%c<text>%c<ship>%c<wave>
      const output =
        "%c          |    |    |\n" +
        "%c         )_)  )_)  )_)     %cDream it.\n" +
        "%c        )___))___))___)\\\\    %cShip it.\n" +
        "%c       )____)____)_____)\\\\\\\\\\n" +
        "%c     _____|____|____|____\\\\\\\\\\\\__\n" +
        "%c----\\\\                   /------\n" +
        "%c" + WAVES[frame % WAVES.length];

      console.log(
        output,
        SHIP,           // Line 1: ship
        SHIP, TEXT,     // Line 2: ship + text
        SHIP, TEXT,     // Line 3: ship + text
        SHIP,           // Line 4: ship
        SHIP,           // Line 5: ship
        SHIP,           // Line 6: ship
        WAVE            // Line 7: wave
      );

      frame++;
    };

    animate();
    setInterval(animate, 200);
  }, []);

  return null;
}
