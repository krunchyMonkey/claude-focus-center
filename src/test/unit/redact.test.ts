import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedExcerpt, redact } from '../../domain/events/redact';

// All "secrets" below are synthetic strings shaped like real credentials.
test('masks common credential shapes', () => {
  const cases: Array<[string, RegExp]> = [
    ['key sk-ant-api03-SYNTHETICSYNTHETIC123 end', /key \[redacted\] end/],
    ['ghp_SYNTHETICSYNTHETICSYNTHETIC1234', /^\[redacted\]$/],
    ['AKIASYNTHETIC0000000', /^\[redacted\]$/],
    ['Authorization: Bearer abcdefghijklmnop.qrstu', /Bearer \[redacted\]/],
    ['https://user:SYNTHETICPW@example.invalid/repo', /\[redacted\]example\.invalid/],
    ['password=hunter2hunter2', /password=\[redacted\]/],
    ['"api_key": "SYNTHETICVALUE"', /"api_key": "\[redacted\]"/],
    ['DB_SECRET: SYNTHETIC123', /DB_SECRET: \[redacted\]/],
    ['-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC\n-----END RSA PRIVATE KEY-----', /^\[redacted\]$/],
  ];
  for (const [input, expected] of cases) {
    assert.match(redact(input), expected, input);
    assert.doesNotMatch(redact(input), /SYNTHETIC(?!SYNTHETIC)|hunter2/i, input);
  }
});

test('leaves ordinary prose alone', () => {
  const text = 'Should I rename the token parser and update the password reset docs?';
  assert.equal(redact(text), text);
});

test('boundedExcerpt collapses whitespace and bounds length from either end', () => {
  assert.equal(boundedExcerpt('  a \n\n b  ', 10), 'a b');
  assert.equal(boundedExcerpt('abcdefghij', 5), 'abcd…');
  assert.equal(boundedExcerpt('abcdefghij', 5, 'end'), '…ghij');
});

test('redaction happens before truncation so a cut secret cannot leak', () => {
  const out = boundedExcerpt(`prefix ghp_${'S'.repeat(30)} suffix`, 20, 'end');
  assert.doesNotMatch(out, /SSSS/);
});
