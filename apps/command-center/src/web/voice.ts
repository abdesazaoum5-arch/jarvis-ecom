/**
 * Voice control.
 *
 * Reports the browser's real Web Speech API support rather than assuming it.
 * Where recognition is unavailable the interface says so plainly and the text
 * command bar remains the full control surface.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

export interface VoiceSupport {
  recognition: boolean;
  synthesis: boolean;
  detail: string;
}

/**
 * Plain-language reasons speech can fail. The interface reports the one that
 * actually occurred: a mic button that does nothing, with no explanation, is
 * indistinguishable from a broken system.
 */
const REASONS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked for this page. Allow it in the browser, or use a page served directly rather than inside a frame.',
  'service-not-allowed': 'The browser refused the speech service for this page.',
  network: 'Speech recognition needs to reach the browser vendor\u2019s speech service, and this network does not allow it. Typing works normally.',
  'no-speech': 'Nothing was heard. Try again closer to the microphone.',
  aborted: 'Listening was cancelled.',
  'audio-capture': 'No microphone was found on this device.',
};

export function reasonFor(error: string): string {
  return REASONS[error] ?? `Speech recognition stopped: ${error}.`;
}

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function detect(): VoiceSupport {
  const rec = recognitionCtor() !== null;
  const syn = typeof window.speechSynthesis !== 'undefined';
  return {
    recognition: rec,
    synthesis: syn,
    detail: rec
      ? 'Speech recognition API is present. Whether the microphone is actually permitted is confirmed separately.'
      : 'This browser exposes no Web Speech recognition API. Type commands instead; nothing else is limited.',
  };
}

/**
 * The API existing is not the same as the microphone being usable: inside a
 * frame without microphone permission the constructor is present and every
 * attempt fails. This asks the browser directly so the status line can say
 * "blocked" before the operator presses the button and gets nothing.
 */
export async function confirmMicrophone(): Promise<{ usable: boolean; detail: string }> {
  if (recognitionCtor() === null) {
    return { usable: false, detail: 'This browser exposes no Web Speech recognition API.' };
  }
  if (typeof navigator.mediaDevices === 'undefined') {
    return { usable: false, detail: 'This page has no access to media devices, so the microphone cannot be used here.' };
  }
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'denied') return { usable: false, detail: REASONS['not-allowed'] as string };
    return {
      usable: true,
      detail: status.state === 'prompt' ? 'The browser will ask for the microphone the first time you press it.' : 'Microphone permitted.',
    };
  } catch {
    // Some browsers do not expose a microphone permission query at all. That is
    // not evidence either way, so the state stays unconfirmed rather than being
    // reported as working.
    return { usable: true, detail: 'This browser will not report microphone permission in advance; pressing the button is the only way to find out.' };
  }
}

export class Voice {
  #rec: SpeechRecognitionLike | null = null;
  #listening = false;

  constructor(private readonly onTranscript: (text: string, final: boolean) => void, private readonly onState: (listening: boolean) => void) {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last) return;
      const alt = last[0];
      if (alt) this.onTranscript(alt.transcript, last.isFinal);
    };
    rec.onerror = (e) => {
      this.onProblem?.(reasonFor(e.error));
      this.#end();
    };
    rec.onend = () => this.#end();
    this.#rec = rec;
  }

  get available(): boolean {
    return this.#rec !== null;
  }

  get listening(): boolean {
    return this.#listening;
  }

  toggle(): void {
    if (!this.#rec) return;
    if (this.#listening) {
      this.#rec.stop();
      this.#end();
    } else {
      try {
        this.#rec.start();
        this.#listening = true;
        this.onState(true);
      } catch (err) {
        this.onProblem?.(reasonFor((err as Error).name === 'InvalidStateError' ? 'aborted' : String((err as Error).message)));
        this.#end();
      }
    }
  }

  #end(): void {
    this.#listening = false;
    this.onState(false);
  }

  /** Called with the plain-language reason whenever speech fails. */
  onProblem: ((reason: string) => void) | null = null;

  /** Called with true while speech is actually being spoken. */
  onSpeaking: ((speaking: boolean) => void) | null = null;

  /** Speaks a reply back. Kept short and interruptible. */
  say(text: string): void {
    if (typeof window.speechSynthesis === 'undefined') return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 320));
    u.rate = 1.02;
    u.pitch = 0.94;
    // The interface reports speaking only while the engine reports it, so the
    // indicator follows the voice rather than predicting it.
    u.onstart = () => this.onSpeaking?.(true);
    u.onend = () => this.onSpeaking?.(false);
    u.onerror = () => this.onSpeaking?.(false);
    window.speechSynthesis.speak(u);
  }

  silence(): void {
    if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
    this.onSpeaking?.(false);
  }
}
