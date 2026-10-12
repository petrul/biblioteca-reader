import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'biblioteca.reader.read-aloud.v1';
const MAX_CHARS = 20_000;

function splitIntoUtterances(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const bounded = normalized.length > MAX_CHARS ? `${normalized.slice(0, MAX_CHARS).trim()}…` : normalized;
  const sentences = bounded.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [bounded];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let remaining = sentence.trim();
    while (remaining.length > 360) {
      const splitAt = remaining.lastIndexOf(' ', 360);
      const cut = splitAt > 80 ? splitAt : 360;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

function languageTag(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const value = language.toLowerCase();
  const tags: Record<string, string> = {
    ro: 'ro', ron: 'ro', rum: 'ro',
    en: 'en', eng: 'en',
    de: 'de', deu: 'de', ger: 'de',
    fr: 'fr', fra: 'fr', fre: 'fr',
    it: 'it', ita: 'it',
    es: 'es', spa: 'es',
    la: 'la', lat: 'la',
  };
  return tags[value] ?? Object.entries(tags).find(([source]) => value.startsWith(source))?.[1];
}

function voiceForLanguage(language: string | undefined): SpeechSynthesisVoice | undefined {
  if (!language || typeof window === 'undefined') return undefined;
  const voices = window.speechSynthesis.getVoices();
  const normalized = language.toLowerCase();
  return voices.find(voice => voice.lang.toLowerCase() === normalized)
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith(`${normalized}-`))
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith(normalized));
}

/** Optional browser speech for the current chapter. It defaults off because
 * speech is audible UI and browser autoplay policies differ. */
export function useSpeechReader(
  chapterId: string | undefined,
  title: string | undefined,
  plainText: string | undefined,
  language?: string,
): { enabled: boolean; speaking: boolean; supported: boolean; voiceAvailable: boolean; requestedLanguage?: string; toggle: () => void; stop: () => void } {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const [voicesVersion, setVoicesVersion] = useState(0);
  // Read-aloud is currently disabled globally. Keep the hook/API in place so
  // the feature can be restored later, but never resume speech from an older
  // local-storage preference while the controls are hidden.
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const runId = useRef(0);
  const requestedLanguage = languageTag(language);
  const selectedVoice = voiceForLanguage(requestedLanguage);
  const voiceAvailable = !requestedLanguage || Boolean(selectedVoice);

  useEffect(() => {
    if (!supported) return;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* optional */ }
    window.speechSynthesis.cancel();
    setEnabled(false);
    setSpeaking(false);
    return () => window.speechSynthesis.cancel();
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => setVoicesVersion(version => version + 1);
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    refresh();
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, [supported]);

  const stop = useCallback(() => {
    runId.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const toggle = useCallback(() => {
    setEnabled(previous => {
      const next = !previous;
      try { window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off'); } catch { /* storage is optional */ }
      if (!next && supported) {
        runId.current += 1;
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
      return next;
    });
  }, [supported]);

  useEffect(() => {
    if (!enabled || !supported || !chapterId || !plainText?.trim()) {
      if (!enabled) stop();
      return;
    }
    if (!voiceAvailable) {
      setSpeaking(false);
      return;
    }
    const currentRun = ++runId.current;
    window.speechSynthesis.cancel();
    const chunks = splitIntoUtterances(title ? `${title}. ${plainText}` : plainText);
    if (!chunks.length) return;
    let index = 0;
    let cancelled = false;
    const speakNext = () => {
      if (cancelled || currentRun !== runId.current || index >= chunks.length) {
        if (index >= chunks.length) setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index++]);
      if (requestedLanguage) {
        utterance.lang = requestedLanguage;
        if (selectedVoice) utterance.voice = selectedVoice;
      }
      utterance.rate = 0.88;
      utterance.pitch = 1;
      utterance.volume = 0.78;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = speakNext;
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };
    const timer = window.setTimeout(speakNext, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      runId.current += 1;
      window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [chapterId, title, plainText, language, enabled, supported, stop, voiceAvailable, requestedLanguage, selectedVoice, voicesVersion]);

  return { enabled, speaking, supported, voiceAvailable, requestedLanguage, toggle, stop };
}
