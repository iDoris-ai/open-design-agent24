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
    expect(mascot.tagName).toBe('IMG');
    expect(mascot.getAttribute('src')).toBe('/idoris-mascot/idle.svg');
    expect(mascot.getAttribute('data-state')).toBe('idle');
    expect(mascot.getAttribute('width')).toBe('72');
    expect(mascot.className).toContain('home-hero__idoris-mascot--breathe');
    expect(mascot.className).toContain('home-hero__idoris-mascot');

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
      expect(mascot.getAttribute('src')).toBe(`/idoris-mascot/${state}.svg`);
      expect(mascot.classList.contains('home-hero__idoris-mascot--breathe')).toBe(state === 'idle');
    }
  });

  it('stops the idle breathe under prefers-reduced-motion: reduce', () => {
    expect(homeHeroCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.home-hero__idoris-mascot\s*\{[^}]*animation:\s*none[^}]*transform:\s*none/,
    );
    expect(homeHeroCss).toContain('image-rendering: pixelated');

    setAgent24Shell(true);
    render(<HomeHero {...heroProps()} />);
    const mascot = screen.getByTestId('idoris-mascot');
    expect(mascot.classList.contains('home-hero__idoris-mascot--breathe')).toBe(true);
  });
});
