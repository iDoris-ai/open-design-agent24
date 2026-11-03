import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const homeHeroSource = read('../../src/components/HomeHero.tsx');
const entryNavRailSource = read('../../src/components/EntryNavRail.tsx');
const logoSvg = read('../../public/logo.svg');
const brandIconSvg = read('../../public/brand-icon.svg');
// #5517: the home hero header shows the full OpenDesign logotype instead of
// the small glyph + name pair; the asset must ship with the app.
const heroLogotypeSvg = read('../../public/logo-03.svg');
// Round 7: the static logotype is now driven by the WebGL pixel-scan wordmark
// (see home-hero/pixel-scan/engine.ts), which samples this SVG's alpha
// channel as the glyph mask it assembles out of coloured blocks.
const heroPixelScanSvg = read('../../public/logo-scan.svg');
const configSource = read('../../src/state/config.ts');
const homeHeroCss = read('../../src/styles/home/home-hero.css');
const mascotComponentSource = read('../../src/components/home-hero/IDorisMascot.tsx');
const mascotSvg = (state: string) => read(`../../public/idoris-mascot/${state}.svg`);

// The current OpenDesign brand glyph is the ink superellipse tile introduced
// with the landing-page rebrand (landing PR #3444): its outline starts with
// this path command in every export of the mark.
const CURRENT_GLYPH_PATH_PREFIX = 'M41 0.726562';
// The retired glyph was a 444x444 dark tile (#202020) whose cursor arrow was
// drawn as a separate path starting at this command.
const RETIRED_GLYPH_MARKERS = ['#202020', 'M212.059', 'width="444"'];

describe('Home logo assets', () => {
  it('ships the current brand glyph in the public logo assets', () => {
    expect(logoSvg).toContain(CURRENT_GLYPH_PATH_PREFIX);
    expect(brandIconSvg).toContain(CURRENT_GLYPH_PATH_PREFIX);
    for (const marker of RETIRED_GLYPH_MARKERS) {
      expect(logoSvg).not.toContain(marker);
      expect(brandIconSvg).not.toContain(marker);
    }
  });

  it('keeps brand-icon.svg maskable (theme color comes from CSS)', () => {
    expect(brandIconSvg).toContain('currentColor');
  });

  it('renders the brand mark on the Home hero', () => {
    // #5517: the hero renders the shipped logotype image (not the glyph pair).
    expect(heroLogotypeSvg).toContain('<svg');
    // The hero header is a plain headline now (per product): the animated
    // pixel-scan wordmark came off it, so the hero mounts neither that
    // component nor any of the retired logotype images. The assets themselves
    // still ship — the rail, the tab chrome and the installers read them.
    expect(heroPixelScanSvg).toContain('<svg');
    expect(homeHeroSource).not.toContain('<PixelScanLogo');
    // The headline still comes from `homeHero.title`; it just renders through
    // the rotating-noun path now (a locale opts in by writing `{word}` into its
    // own string, so the key stays the single source for the sentence).
    expect(homeHeroSource).toContain("t('homeHero.title')");
    expect(homeHeroSource).toContain('<RotatingTitleWord');
    expect(homeHeroSource).not.toContain('src="/logo-03.svg"');
    expect(homeHeroSource).not.toContain('src="/app-icon.svg"');

    // #6156 cut the rail's signed-out brand header entirely — with no cloud
    // identity the rail now starts at the search box, and expand/collapse moved
    // to the workspace tabs bar's pinned Home toggle. So the rail carries no
    // brand mark at all; what still matters is that it never falls back to the
    // retired raster app icon.
    expect(entryNavRailSource).not.toContain('src="/app-icon.svg"');
  });

  it('points the Agent24 home mascot at the pixel iDoris poses', () => {
    for (const state of ['idle', 'thinking', 'success', 'error'] as const) {
      const svg = mascotSvg(state);
      expect(svg).toContain(`id="idoris-state-${state}"`);
      expect(svg).toContain('id="idoris-outline"');
      expect(svg).toContain('shape-rendering="crispEdges"');
      expect(svg).toContain('viewBox="0 0 48 66"');
      expect(svg).toContain('apps/desktop/src/renderer/assets/logo-welcome.png');
    }
    expect(homeHeroSource).toContain('<RotatingTitleWord');
    expect(homeHeroSource).toContain('isAgent24Shell()');
    expect(homeHeroSource).toContain('<IDorisMascot state="idle" />');
    expect(mascotComponentSource).toContain("const alive = state === 'idle'");
    expect(mascotComponentSource).toContain("' home-hero__idoris-mascot--alive'");
    expect(mascotComponentSource).toContain("'/idoris-mascot/blink.svg'");
    expect(mascotComponentSource).toContain("idle: '/idoris-mascot/idle.svg'");
    expect(mascotComponentSource).toContain("thinking: '/idoris-mascot/thinking.svg'");
    expect(mascotComponentSource).toContain("success: '/idoris-mascot/success.svg'");
    expect(mascotComponentSource).toContain("error: '/idoris-mascot/error.svg'");
    expect(homeHeroCss).toContain('image-rendering: pixelated');
    expect(homeHeroCss).toContain('width: 72px');
    const reduced = homeHeroCss.slice(homeHeroCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    const block = reduced.slice(0, reduced.indexOf('}') + reduced.slice(reduced.indexOf('}') + 1).indexOf('}') + 2);
    expect(block).toContain('.home-hero__idoris-mascot--alive .home-hero__idoris-mascot-float');
    expect(block).toContain('.home-hero__idoris-mascot--alive:hover .home-hero__idoris-mascot-hop');
    expect(block).toContain('.home-hero__idoris-mascot--alive .home-hero__idoris-mascot-frame--blink');
    expect(block).toContain('animation: none');
    expect(block).toContain('transform: none');
    expect(block).toContain('opacity: 0');
    expect(configSource).toMatch(
      /export const DEFAULT_PET: PetConfig = \{\s*adopted: false,\s*enabled: false,/,
    );
  });

  it('ships a blink frame the same size as idle, changing only the eye cells', () => {
    const idle = mascotSvg('idle');
    const blink = mascotSvg('blink');
    const rootTag = (svg: string) => svg.slice(svg.indexOf('<svg'), svg.indexOf('>', svg.indexOf('<svg')) + 1);
    const idleRoot = rootTag(idle);
    const blinkRoot = rootTag(blink);
    for (const attr of ['viewBox="0 0 48 66"', 'width="48"', 'height="66"', 'shape-rendering="crispEdges"']) {
      expect(idleRoot).toContain(attr);
      expect(blinkRoot).toContain(attr);
    }
    expect(blink).toContain('id="idoris-state-blink"');
    expect(blink).toContain('id="idoris-outline"');

    const paint = (svg: string) => {
      const cells = new Map<string, string>();
      const fillStack: Array<string | null> = [];
      let fill: string | null = null;
      for (const line of svg.split('\n')) {
        if (line.includes('<g')) {
          fillStack.push(fill);
          const match = line.match(/fill="(#[0-9A-Fa-f]{6})"/);
          if (match?.[1]) fill = match[1].toUpperCase();
        }
        if (line.includes('</g>') && fillStack.length > 0) fill = fillStack.pop() ?? null;
        const rect = line.match(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/);
        if (!rect || fill == null) continue;
        const x = Number(rect[1]);
        const y = Number(rect[2]);
        const w = Number(rect[3]);
        const h = Number(rect[4]);
        for (let yy = y; yy < y + h; yy += 1) {
          for (let xx = x; xx < x + w; xx += 1) cells.set(`${xx},${yy}`, fill);
        }
      }
      return cells;
    };
    const idleCells = paint(idle);
    const blinkCells = paint(blink);
    const changed: string[] = [];
    for (const key of new Set([...idleCells.keys(), ...blinkCells.keys()])) {
      if (idleCells.get(key) !== blinkCells.get(key)) changed.push(key);
    }
    changed.sort();
    expect(changed).toEqual([
      '13,26',
      '13,27',
      '14,25',
      '14,26',
      '15,24',
      '15,25',
      '15,27',
      '22,25',
      '22,26',
      '24,26',
      '25,25',
      '26,25',
    ]);
    const skin = '#F9D7B9';
    const black = '#000000';
    expect(blinkCells.get('13,26')).toBe(black);
    expect(blinkCells.get('14,26')).toBe(black);
    expect(blinkCells.get('15,26')).toBe(black);
    expect(blinkCells.get('22,25')).toBe(black);
    expect(blinkCells.get('23,25')).toBe(black);
    expect(blinkCells.get('24,25')).toBe(black);
    expect(blinkCells.get('25,25')).toBe(black);
    expect(blinkCells.get('26,25')).toBe(black);
    for (const cell of ['15,24', '14,25', '15,25', '22,26', '24,26', '13,27', '15,27']) {
      expect(blinkCells.get(cell)).toBe(skin);
    }
  });
});
