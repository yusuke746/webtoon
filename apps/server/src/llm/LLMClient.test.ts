import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJson } from './LLMClient.js';

test('extractJson parses valid fenced JSON', () => {
  assert.deepEqual(extractJson('```json\n{"title":"第1話"}\n```'), { title: '第1話' });
});

test('extractJson repairs an unescaped quote in an LLM string value', () => {
  const malformed = '{"summary":"彼は"行く"と答えた","episodes":[]}';

  assert.deepEqual(extractJson(malformed), {
    summary: '彼は"行く"と答えた',
    episodes: [],
  });
});