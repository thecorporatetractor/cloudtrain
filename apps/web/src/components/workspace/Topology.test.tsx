import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LinkMenuItems } from './Topology';

const noop = () => undefined;

describe('topology link menu', () => {
  it('offers capture and impairment when the lab supports them', () => {
    const h = renderToStaticMarkup(<LinkMenuItems onCapture={noop} onImpair={noop} onPick={noop} />);
    expect(h).toContain('Capture on this link');
    expect(h).toContain('Impair (latency, loss)');
  });

  it('says they are not available in a live lab instead of offering them', () => {
    const h = renderToStaticMarkup(<LinkMenuItems onPick={noop} />);
    expect(h).not.toContain('Capture on this link');
    expect(h).not.toContain('<button');
    expect(h).toContain('not available in live labs yet');
    expect(h).toContain('aria-disabled="true"');
  });
});
