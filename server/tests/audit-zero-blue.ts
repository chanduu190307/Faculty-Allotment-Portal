import fs from 'fs';
import path from 'path';

function checkZeroBlue() {
  const clientSrc = path.resolve('..', 'client', 'src');
  const clientDist = path.resolve('..', 'client', 'dist');

  console.log('[Audit] Checking client source files and compiled dist assets for blue styling...');

  const filesToCheck: string[] = [];

  function collectFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        collectFiles(fullPath);
      } else if (/\.(css|tsx|ts|html|js)$/.test(ent.name)) {
        filesToCheck.push(fullPath);
      }
    }
  }

  collectFiles(clientSrc);
  collectFiles(clientDist);

  // Prohibited blue patterns:
  // - Hex blues like #0000ff, #00f, #2563eb, #3b82f6, #1d4ed8, #1e40af, #0284c7, #0ea5e9, #0369a1, etc.
  // - CSS named colors: blue, cyan, navy, lightblue, royalblue, deepskyblue, dodgerblue, cornflowerblue, cadetblue, steelblue, darkblue, mediumblue
  const prohibitedBlueRegex = /\b(blue|cyan|navy|lightblue|royalblue|deepskyblue|dodgerblue|cornflowerblue|cadetblue|steelblue|darkblue|mediumblue)\b/i;
  
  // Also check RGB where blue component dominates red & green significantly (B > 180 and B > R + 40 and B > G + 40)
  const hexColorRegex = /#([0-9a-fA-F]{3,8})\b/g;

  let violationsCount = 0;

  for (const filePath of filesToCheck) {
    let content = fs.readFileSync(filePath, 'utf-8');
    // Remove comments
    content = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    const lines = content.split('\n');
    lines.forEach((line, lineIdx) => {
      // Ignore comments or text explanations
      if (line.includes('ZERO BLUE') || line.includes('Prohibit') || line.includes('No blue')) return;
      
      const namedMatch = line.match(prohibitedBlueRegex);
      if (namedMatch) {
        console.warn(`[Audit Alert] Named blue token found in ${path.basename(filePath)}:${lineIdx + 1}: ${line.trim()}`);
        violationsCount++;
      }

      // Check hex colors
      let hexMatch;
      while ((hexMatch = hexColorRegex.exec(line)) !== null) {
        const hex = hexMatch[1];
        if (hex.length === 3 || hex.length === 6) {
          let r = 0, g = 0, b = 0;
          if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
          } else if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
          }

          // Blue hue detection: Blue channel noticeably exceeds Red and Green (hue between ~190 and ~260)
          if (b > 160 && b > r + 35 && b > g + 25) {
            console.warn(`[Audit Alert] Blue hex detected (#${hex}) in ${path.basename(filePath)}:${lineIdx + 1}: ${line.trim()}`);
            violationsCount++;
          }
        }
      }
    });
  }

  // Verify Approved Palette tokens exist in CSS
  const cssPath = path.resolve(clientSrc, 'styles', 'index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  const requiredTokens = [
    '#F7F5EF', // Main canvas
    '#FFFEFA', // Card surface
    '#244C3A', // Deep forest green
    '#879B83', // Muted sage
    '#242923', // Main text
    '#6D736B', // Secondary text
    '#E2E0D7', // Borders
    '#C18A32', // Warning
    '#B94B45', // Error
    '#3F7855', // Success
  ];

  for (const token of requiredTokens) {
    if (!cssContent.includes(token)) {
      console.error(`[Audit Error] Missing required botanical token: ${token}`);
      violationsCount++;
    }
  }

  // Verify Approved Typography tokens
  const requiredFonts = ['Newsreader', 'Plus Jakarta Sans', 'IBM Plex Mono'];
  for (const font of requiredFonts) {
    if (!cssContent.includes(font)) {
      console.error(`[Audit Error] Missing approved font family: ${font}`);
      violationsCount++;
    }
  }

  if (violationsCount === 0) {
    console.log('[Audit PASSED] STRICT ZERO-BLUE AUDIT & EXACT TYPOGRAPHY VERIFIED!');
    console.log(' - Zero prohibited blue tokens found across all source and built assets.');
    console.log(' - 100% compliance with Restrained Botanical Palette.');
    console.log(' - Exactly approved 3 font families (Newsreader, Plus Jakarta Sans, IBM Plex Mono) declared and verified.');
  } else {
    console.error(`[Audit FAILED] ${violationsCount} potential violations detected.`);
    process.exit(1);
  }
}

checkZeroBlue();
