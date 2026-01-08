import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// Read the favicon SVG
const faviconSvg = fs.readFileSync(path.join(publicDir, 'favicon.svg'));
const logoSvg = fs.readFileSync(path.join(publicDir, 'logo.svg'));

async function generateIcons() {
  console.log('Generating icons...');

  // Generate favicon PNGs at different sizes
  const sizes = [16, 32, 48];
  const pngBuffers = [];

  for (const size of sizes) {
    const pngBuffer = await sharp(faviconSvg)
      .resize(size, size)
      .png()
      .toBuffer();

    pngBuffers.push({ size, buffer: pngBuffer });
    console.log(`Generated ${size}x${size} PNG`);
  }

  // Generate apple-touch-icon (180x180 from logo.svg)
  await sharp(logoSvg)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png (180x180)');

  // For favicon.ico, we'll create a multi-size ICO
  // Since sharp doesn't directly support ICO, we'll create the PNG version
  // and rely on favicon.svg for modern browsers

  // Create favicon-32.png as a fallback
  await sharp(faviconSvg)
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon-32.png'));
  console.log('Generated favicon-32.png');

  // Create a 48x48 version for higher DPI
  await sharp(faviconSvg)
    .resize(48, 48)
    .png()
    .toFile(path.join(publicDir, 'favicon-48.png'));
  console.log('Generated favicon-48.png');

  // Generate PWA icons
  await sharp(logoSvg)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));
  console.log('Generated icon-192.png');

  await sharp(logoSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));
  console.log('Generated icon-512.png');

  console.log('Done! Icons generated successfully.');
  console.log('\nNote: For favicon.ico, use an online converter or ImageMagick:');
  console.log('  convert favicon-32.png favicon-48.png favicon.ico');
}

generateIcons().catch(console.error);
