# PlexMCP Brand Guidelines

## Official Logo

The PlexMCP logo is a geometric "P" with three fading dots representing multiplexing connections.

### Logo Elements

```
┌─────────────────────────────────────┐
│                                     │
│   ██████████████████  ●             │
│   ██              ██    ●           │
│   ██  ████████████████               │
│   ██  ██          ██      ●         │
│   ██  ████████████████               │
│   ██                                │
│   ██                                │
│   ██                                │
│                                     │
└─────────────────────────────────────┘
```

1. **Geometric P Shape** - Built from rectangular blocks with rounded corners
2. **Three Fading Dots** - Positioned on the right side, fading down:
   - Top dot: opacity 0.6, largest
   - Middle dot: opacity 0.4, medium
   - Bottom dot: opacity 0.3, smallest

### Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Indigo | `#6366f1` | Gradient start |
| Purple | `#8b5cf6` | Gradient end |

The logo uses a linear gradient from indigo to purple (top-left to bottom-right).

---

## Logo Files

All logo files are in `/web/public/`:

| File | Size | Purpose |
|------|------|---------|
| `logo.svg` | 48x48 | Primary logo (header, sidebar) |
| `favicon.svg` | 32x32 | Browser favicon (SVG) |
| `favicon.ico` | multi | Browser favicon (ICO format, 16/32/48px) |
| `favicon-16.png` | 16x16 | Small favicon |
| `favicon-32.png` | 32x32 | Standard favicon |
| `favicon-48.png` | 48x48 | Large favicon |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `icon-192.png` | 192x192 | PWA icon |
| `icon-512.png` | 512x512 | PWA splash |

---

## SVG Source Code

### Primary Logo (`logo.svg`)

```svg
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="plexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>

  <!-- Geometric P logo -->
  <!-- Vertical bar -->
  <rect x="8" y="6" width="8" height="36" rx="2" fill="url(#plexGradient)"/>
  <!-- Top horizontal -->
  <rect x="14" y="6" width="18" height="8" rx="2" fill="url(#plexGradient)"/>
  <!-- Right side vertical -->
  <rect x="28" y="12" width="8" height="14" rx="2" fill="url(#plexGradient)"/>
  <!-- Bottom horizontal of P bowl -->
  <rect x="14" y="22" width="18" height="8" rx="2" fill="url(#plexGradient)"/>

  <!-- Multiplexing dots - fading down -->
  <circle cx="40" cy="10" r="3" fill="url(#plexGradient)" opacity="0.6"/>
  <circle cx="44" cy="20" r="2.5" fill="url(#plexGradient)" opacity="0.4"/>
  <circle cx="42" cy="32" r="2" fill="url(#plexGradient)" opacity="0.3"/>
</svg>
```

---

## Regenerating Favicons

If the logo SVG is updated, regenerate all favicon files:

```bash
cd /web/public

# Generate PNG favicons
magick -background none -density 300 favicon.svg -resize 16x16 favicon-16.png
magick -background none -density 300 favicon.svg -resize 32x32 favicon-32.png
magick -background none -density 300 favicon.svg -resize 48x48 favicon-48.png

# Generate ICO (multi-size)
magick favicon-16.png favicon-32.png favicon-48.png favicon.ico

# Generate larger icons from logo.svg
magick -background none -density 300 logo.svg -resize 180x180 apple-touch-icon.png
magick -background none -density 300 logo.svg -resize 192x192 icon-192.png
magick -background none -density 300 logo.svg -resize 512x512 icon-512.png
```

---

## Usage Guidelines

### Do
- Use the logo with the fading dots - they represent the multiplexing concept
- Maintain the gradient direction (top-left to bottom-right)
- Keep adequate spacing around the logo

### Don't
- Remove the fading dots
- Change the gradient colors
- Distort the proportions
- Use the logo without the dots (that's the old version)

---

## Version History

| Date | Change |
|------|--------|
| 2024-12-20 | Documented brand guidelines, regenerated all favicons with fading dots |
| Initial | Created geometric P logo with multiplexing dots |
