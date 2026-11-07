import axe from 'axe-core';

/**
 * What axe finds wrong with `container` as it is: each rule broken, and where. Contrast is left
 * out: the faintest labels, like macOS's tertiary ones, are below 4.5:1 on purpose, and axe
 * cannot see the vibrancy behind the sidebar. The document's own rules, such as its title, are
 * the app's root layout's, which a component test does not render.
 */
export async function violations(container: Element) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}
