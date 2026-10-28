import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPanelImagePrompt } from './story.js';

test('buildPanelImagePrompt prevents image-native text and speech bubbles', () => {
  const prompt = buildPanelImagePrompt('black and white manga', 'close-up of the protagonist');

  assert.match(prompt, /no text/);
  assert.match(prompt, /no speech bubbles/);
  assert.match(prompt, /negative space around the edges/);
});