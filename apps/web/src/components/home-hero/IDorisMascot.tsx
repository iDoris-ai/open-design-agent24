/**
 * Pixel iDoris beside the Agent24 home title.
 *
 * The four poses are public SVGs downsampled from
 * `apps/desktop/src/renderer/assets/logo-welcome.png`. Each file is one
 * pose (`#idoris-state-*`) plus the dark-ground outline (`#idoris-outline`).
 * Pass `state` to switch; the home hero only has an idle pose to show,
 * because that screen has no in-progress, success, or failure run.
 */

export type IDorisMascotState = 'idle' | 'thinking' | 'success' | 'error';

const MASCOT_SRC: Record<IDorisMascotState, string> = {
  idle: '/idoris-mascot/idle.svg',
  thinking: '/idoris-mascot/thinking.svg',
  success: '/idoris-mascot/success.svg',
  error: '/idoris-mascot/error.svg',
};

/** Display width. Height follows the 48×66 viewBox (72 × 66 / 48 = 99). */
export const IDORIS_MASCOT_WIDTH_PX = 72;
export const IDORIS_MASCOT_HEIGHT_PX = 99;

const BLINK_SRC = '/idoris-mascot/blink.svg';

export function IDorisMascot({ state = 'idle' }: { state?: IDorisMascotState }) {
  const alive = state === 'idle';
  return (
    <span
      className={'home-hero__idoris-mascot' + (alive ? ' home-hero__idoris-mascot--alive' : '')}
      data-state={state}
      data-testid="idoris-mascot"
      aria-hidden="true"
    >
      <span className="home-hero__idoris-mascot-hop">
        <span className="home-hero__idoris-mascot-float">
          <img
            className="home-hero__idoris-mascot-frame home-hero__idoris-mascot-frame--base"
            src={MASCOT_SRC[state]}
            alt=""
            width={IDORIS_MASCOT_WIDTH_PX}
            height={IDORIS_MASCOT_HEIGHT_PX}
            draggable={false}
          />
          {alive ? (
            <img
              className="home-hero__idoris-mascot-frame home-hero__idoris-mascot-frame--blink"
              src={BLINK_SRC}
              alt=""
              width={IDORIS_MASCOT_WIDTH_PX}
              height={IDORIS_MASCOT_HEIGHT_PX}
              draggable={false}
            />
          ) : null}
        </span>
      </span>
    </span>
  );
}
