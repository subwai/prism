import DEFAULTS from '#default-keybindings.jsonc?raw';
import { readKeybindings } from '#file';
import { createKeymap } from '#keymap';
import { keybindingsTemplate } from '#template';
import { expect, test } from 'vitest';

test('the defaults that ship with the app all apply', () => {
  const { error, rules } = readKeybindings(DEFAULTS);
  expect(error).toBeNull();
  expect(createKeymap('darwin', rules).errors).toEqual([]);
});

test('a new keybindings.json changes nothing, and notes every command', () => {
  const { error, rules } = readKeybindings(keybindingsTemplate());
  expect(error).toBeNull();
  expect(rules).toEqual([]);
  expect(keybindingsTemplate()).toContain('//   seekForward ');
});
