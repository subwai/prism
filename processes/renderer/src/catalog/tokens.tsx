import { Example, Section } from '#catalog/section';

const COLORS = [
  ['label', 'bg-label'],
  ['label-secondary', 'bg-label-secondary'],
  ['label-tertiary', 'bg-label-tertiary'],
  ['label-quaternary', 'bg-label-quaternary'],
  ['separator', 'bg-separator'],
  ['fill', 'bg-fill'],
  ['fill-strong', 'bg-fill-strong'],
  ['fill-selected', 'bg-fill-selected'],
  ['fill-focused', 'bg-fill-focused'],
  ['accent', 'bg-accent'],
  ['accent-hover', 'bg-accent-hover'],
  ['on-accent', 'bg-on-accent'],
  ['surface', 'bg-surface'],
  ['menu', 'bg-menu'],
  ['hud', 'bg-hud'],
  ['edge', 'bg-edge'],
  ['edge-subtle', 'bg-edge-subtle'],
  ['scrim', 'bg-scrim'],
  ['on-media', 'bg-on-media'],
  ['warning', 'bg-warning'],
  ['warning-fill', 'bg-warning-fill'],
  ['danger', 'bg-danger'],
  ['danger-fill', 'bg-danger-fill']
] as const;

const TYPE = [
  ['3xl', 'text-3xl', '34px'],
  ['2xl', 'text-2xl', '24px'],
  ['xl', 'text-xl', '15px'],
  ['lg', 'text-lg', '14px'],
  ['md', 'text-md', '13px'],
  ['base', 'text-base', '12px'],
  ['sm', 'text-sm', '11px'],
  ['xs', 'text-xs', '10px'],
  ['2xs', 'text-2xs', '9px'],
  ['3xs', 'text-3xs', '8px']
] as const;

const RADII = [
  ['xs', 'rounded-xs'],
  ['sm', 'rounded-sm'],
  ['inner', 'rounded-inner'],
  ['control', 'rounded-control'],
  ['field', 'rounded-field'],
  ['card', 'rounded-card'],
  ['menu', 'rounded-menu'],
  ['window', 'rounded-window']
] as const;

const SHADOWS = [
  ['raised', 'shadow-raised'],
  ['button', 'shadow-button'],
  ['toast', 'shadow-toast'],
  ['photo', 'shadow-photo'],
  ['icon', 'shadow-icon'],
  ['window', 'shadow-window']
] as const;

export function Tokens() {
  return (
    <>
      <Section title="Colours">
        <div className="grid grid-cols-6 gap-4">
          {COLORS.map(([name, className]) => (
            <Example key={name} label={name}>
              <span className={`rounded-control inset-ring-edge size-10 inset-ring ${className}`} />
            </Example>
          ))}
        </div>
      </Section>
      <Section title="Type">
        <div className="flex flex-col gap-2">
          {TYPE.map(([name, className, size]) => (
            <div key={name} className="flex items-baseline gap-4">
              <span className="text-label-tertiary w-16 shrink-0 text-xs">
                {name} · {size}
              </span>
              <span className={className}>Photos, where they are</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4">
            <span className="text-label-tertiary w-16 shrink-0 text-xs">eyebrow</span>
            <span className="eyebrow">Photos, where they are</span>
          </div>
        </div>
      </Section>
      <Section title="Radii and shadows">
        <div className="flex flex-wrap gap-4">
          {RADII.map(([name, className]) => (
            <Example key={name} label={name}>
              <span className={`bg-fill-strong size-12 ${className}`} />
            </Example>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          {SHADOWS.map(([name, className]) => (
            <Example key={name} label={name}>
              <span className={`rounded-card bg-menu size-12 ${className}`} />
            </Example>
          ))}
        </div>
      </Section>
    </>
  );
}
