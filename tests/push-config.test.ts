import { describe, it, expect } from 'vitest';
import { parsePushConfig } from '../electron/push-config';

const file = { relayUrl: 'wss://push.example.com', pushTopic: 'projects/p/topics/gmail-push' };

describe('parsePushConfig', () => {
  it('reads both values from the config file', () => {
    expect(parsePushConfig(file, {})).toEqual(file);
  });

  it('returns null when either value is missing, so push simply stays off', () => {
    expect(parsePushConfig({ relayUrl: file.relayUrl }, {})).toBeNull();
    expect(parsePushConfig({ pushTopic: file.pushTopic }, {})).toBeNull();
    expect(parsePushConfig(null, {})).toBeNull();
  });

  it('refuses a url that is not a websocket url', () => {
    expect(parsePushConfig({ ...file, relayUrl: 'https://push.example.com' }, {})).toBeNull();
  });

  it('accepts ws:// for a local relay', () => {
    expect(parsePushConfig({ ...file, relayUrl: 'ws://localhost:8099' }, {})?.relayUrl).toBe(
      'ws://localhost:8099',
    );
    expect(parsePushConfig({ ...file, relayUrl: 'ws://127.0.0.1:8099' }, {})?.relayUrl).toBe(
      'ws://127.0.0.1:8099',
    );
    // De IPv6-notatie van loopback; URL.hostname geeft die mét blokhaken terug
    // ('[::1]', niet '::1'), dus dit moet net zo goed geaccepteerd worden.
    expect(parsePushConfig({ ...file, relayUrl: 'ws://[::1]:8099' }, {})?.relayUrl).toBe(
      'ws://[::1]:8099',
    );
  });

  // Het eerste frame dat over deze verbinding gaat bevat een levend Google access
  // token. Onversleuteld mag dat alleen naar deze machine zelf — dat is precies
  // wat het lokaal uitproberen uit de spec nodig heeft, en verder niets.
  it('refuses plaintext ws:// to anything but loopback', () => {
    expect(parsePushConfig({ ...file, relayUrl: 'ws://push.example.com' }, {})).toBeNull();
    expect(parsePushConfig({ ...file, relayUrl: 'ws://192.168.1.10:8099' }, {})).toBeNull();
    // Ook niet via de omgevingsvariabele, en ook niet met een hostnaam die er
    // alleen maar lokaal uitziet.
    expect(parsePushConfig(file, { GMAIL_PUSH_RELAY_URL: 'ws://localhost.evil.example' })).toBeNull();
  });

  it('keeps accepting wss:// for a real relay', () => {
    expect(parsePushConfig(file, {})?.relayUrl).toBe('wss://push.example.com');
  });

  it('lets the environment win, so you can test against a local relay', () => {
    const env = {
      GMAIL_PUSH_RELAY_URL: 'ws://localhost:8099',
      GMAIL_PUSH_TOPIC: 'projects/dev/topics/gmail-push',
    };
    expect(parsePushConfig(file, env)).toEqual({
      relayUrl: 'ws://localhost:8099',
      pushTopic: 'projects/dev/topics/gmail-push',
    });
  });

  it('takes one value from the environment and the other from the file', () => {
    expect(parsePushConfig(file, { GMAIL_PUSH_RELAY_URL: 'ws://localhost:8099' })).toEqual({
      relayUrl: 'ws://localhost:8099',
      pushTopic: file.pushTopic,
    });
  });

  it('trims surrounding whitespace instead of building a broken url', () => {
    expect(parsePushConfig(file, { GMAIL_PUSH_RELAY_URL: '  ws://localhost:8099  ' })?.relayUrl).toBe(
      'ws://localhost:8099',
    );
  });
});
