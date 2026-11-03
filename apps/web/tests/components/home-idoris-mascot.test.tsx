// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HomeHero } from '../../src/components/HomeHero';
import { IDorisMascot, type IDorisMascotState } from '../../src/components/home-hero/IDorisMascot';

// jsdom rewrites import.meta.url away from a file: URL, so this read goes
// through the vitest cwd (apps/web) instead.
const homeHeroCss = readFileSync(join(process.cwd(), 'src/styles/home/home-hero.css'), 'utf8');

afterEach(() => {
  cleanup();
  delete (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__;
});

function heroProps(
  overrides: Partial<React.ComponentProps<typeof HomeHero>> = {},
): React.ComponentProps<typeof HomeHero> {
  return {
    prompt: '',
    onPromptChange: () => undefined,
    onSubmit: () => undefined,
    activePluginTitle: null,
    activeChipId: null,
    onClearActivePlugin: () => undefined,
    pluginOptions: [],
    pluginsLoading: false,
    pendingPluginId: null,
    pendingChipId: null,
    onPickPlugin: () => undefined,
    onPickChip: () => undefined,
    contextItemCount: 0,
    error: null,
    ...overrides,
  } as React.ComponentProps<typeof HomeHero>;
}

function setAgent24Shell(on: boolean) {
  (globalThis as { __OD_IS_AGENT24__?: boolean }).__OD_IS_AGENT24__ = on;
}

describe('iDoris home mascot', () => {
  it('renders the idle pixel mascot beside the rotating title in the Agent24 shell', () => {
    setAgent24Shell(true);
    render(<HomeHero {...heroProps()} />);

    const mascot = screen.getByTestId('idoris-mascot');
    expect(mascot.tagName).toBe('SPAN');
    expect(mascot.getAttribute('data-state')).toBe('idle');
    expect(mascot.className).toContain('home-hero__idoris-mascot--alive');
    expect(mascot.className).toContain('home-hero__idoris-mascot');
    const base = mascot.querySelector('.home-hero__idoris-mascot-frame--base');
    expect(base?.tagName).toBe('IMG');
    expect(base?.getAttribute('src')).toBe('/idoris-mascot/idle.svg');
    expect(base?.getAttribute('width')).toBe('72');
    expect(mascot.querySelector('.home-hero__idoris-mascot-frame--blink')?.getAttribute('src')).toBe(
      '/idoris-mascot/blink.svg',
    );

    const title = screen.getByRole('heading', { level: 1 });
    expect(title.className).toContain('home-hero__title--with-mascot');
    expect(title.contains(mascot)).toBe(true);
    // No type picked yet: the headline is the unselected sentence, and the
    // rotating noun stays unmounted until `{word}` is in the string.
    expect(title.textContent).toContain('What would you like to create?');
    expect(screen.getByTestId('home-hero').getAttribute('data-collapsed')).toBeNull();
  });

  it('keeps RotatingTitleWord beside the mascot once a type is picked', () => {
    setAgent24Shell(true);
    render(<HomeHero {...heroProps({ activeChipId: 'prototype' })} />);

    const title = screen.getByRole('heading', { level: 1 });
    const mascot = screen.getByTestId('idoris-mascot');
    expect(title.contains(mascot)).toBe(true);
    expect(mascot.getAttribute('data-state')).toBe('idle');
    expect(title.textContent).toContain('Prototype');
  });

  it('leaves the upstream home title without a mascot', () => {
    setAgent24Shell(false);
    render(<HomeHero {...heroProps()} />);

    expect(screen.queryByTestId('idoris-mascot')).toBeNull();
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.className).not.toContain('home-hero__title--with-mascot');
    expect(title.textContent).toContain('What would you like to create?');
    expect(title.querySelector('.home-hero__title-text')).toBeNull();
  });

  it('keeps the dock folded and untitled when the Agent24 shell is on', () => {
    setAgent24Shell(true);
    render(<HomeHero {...heroProps({ variant: 'dock' })} />);

    expect(screen.queryByTestId('idoris-mascot')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByTestId('home-hero').getAttribute('data-collapsed')).toBe('true');
  });

  it('switches pose from the state prop', () => {
    const states: IDorisMascotState[] = ['idle', 'thinking', 'success', 'error'];
    for (const state of states) {
      cleanup();
      render(<IDorisMascot state={state} />);
      const mascot = screen.getByTestId('idoris-mascot');
      expect(mascot.getAttribute('data-state')).toBe(state);
      expect(mascot.querySelector('.home-hero__idoris-mascot-frame--base')?.getAttribute('src')).toBe(
        `/idoris-mascot/${state}.svg`,
      );
      expect(mascot.classList.contains('home-hero__idoris-mascot--alive')).toBe(state === 'idle');
      expect(mascot.querySelector('.home-hero__idoris-mascot-frame--blink')?.getAttribute('src') ?? null).toBe(
        state === 'idle' ? '/idoris-mascot/blink.svg' : null,
      );
    }
  });

  it('stops float, sway, blink, and hover under prefers-reduced-motion: reduce', () => {
    const reduced = homeHeroCss.slice(homeHeroCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    const block = reduced.slice(0, reduced.indexOf('}') + reduced.slice(reduced.indexOf('}') + 1).indexOf('}') + 2);
    expect(block).toContain('.home-hero__idoris-mascot--alive .home-hero__idoris-mascot-float');
    expect(block).toContain('.home-hero__idoris-mascot--alive:hover .home-hero__idoris-mascot-hop');
    expect(block).toContain('.home-hero__idoris-mascot--alive .home-hero__idoris-mascot-frame--blink');
    expect(block).toContain('animation: none');
    expect(block).toContain('transform: none');
    expect(block).toContain('opacity: 0');
    expect(homeHeroCss).toContain('image-rendering: pixelated');
    expect(homeHeroCss).toContain('translate(1px, -5px)');
    expect(homeHeroCss).toContain('steps(5, jump-none)');
    // Rotation or fractional easing would smear the pixel art.
    expect(homeHeroCss).not.toMatch(/idoris-mascot[\s\S]{0,400}rotate\(/);
    expect(homeHeroCss).toContain('translateY(-6px)');
    expect(homeHeroCss).toContain('idoris-mascot-blink 4s');

    setAgent24Shell(true);
    render(<HomeHero {...heroProps()} />);
    const mascot = screen.getByTestId('idoris-mascot');
    expect(mascot.classList.contains('home-hero__idoris-mascot--alive')).toBe(true);
  });
});
