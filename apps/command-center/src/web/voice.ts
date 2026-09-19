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
  'not-allowed': 'De microfoon is geblokkeerd voor deze pagina. Sta hem toe in de browser, of open de pagina rechtstreeks in plaats van in een kader.',
  'service-not-allowed': 'De browser weigerde de spraakdienst voor deze pagina.',
  network: 'Spraakherkenning moet de spraakdienst van de browser kunnen bereiken, en dit netwerk laat dat niet toe. Typen werkt gewoon.',
  'no-speech': 'Ik heb niets gehoord. Probeer het opnieuw, dichter bij de microfoon.',
  aborted: 'Het luisteren is afgebroken.',
  'audio-capture': 'Er is geen microfoon gevonden op dit apparaat.',
};

/** Why the browser refused to speak, in words the operator can act on. */
const SPEECH_REASONS: Record<string, string> = {
  'not-allowed': 'De browser praat pas nadat u de pagina hebt aangeraakt. Klik één keer en vraag het opnieuw.',
  'audio-busy': 'De geluidsuitvoer is bezet. Sluit wat er verder de speakers gebruikt en vraag het opnieuw.',
  'synthesis-failed': 'De spraakmotor gaf een fout. Op Windows betekent dat meestal dat er geen stem is geïnstalleerd: voeg er een toe bij Instellingen, Tijd en taal, Spraak.',
  'synthesis-unavailable': 'Deze browser heeft geen stem geïnstalleerd, dus antwoorden blijven alleen op het scherm staan.',
  'language-unavailable': 'Geen enkele geïnstalleerde stem spreekt deze taal, dus antwoorden blijven alleen op het scherm staan.',
  'voice-unavailable': 'De gekozen stem is niet beschikbaar op deze machine.',
};

export function reasonFor(error: string): string {
  return REASONS[error] ?? `De spraakherkenning stopte: ${error}.`;
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
      ? 'De spraakherkenning is aanwezig. Of de microfoon werkelijk is toegestaan, wordt apart nagegaan.'
      : 'Deze browser heeft geen spraakherkenning. Typ uw opdrachten; verder is er niets beperkt.',
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
    return { usable: false, detail: 'Deze browser heeft geen spraakherkenning.' };
  }
  if (typeof navigator.mediaDevices === 'undefined') {
    return { usable: false, detail: 'Deze pagina heeft geen toegang tot media-apparaten, dus de microfoon kan hier niet worden gebruikt.' };
  }
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'denied') return { usable: false, detail: REASONS['not-allowed'] as string };
    return {
      usable: true,
      detail: status.state === 'prompt' ? 'De browser vraagt om de microfoon zodra u hem voor het eerst indrukt.' : 'Microfoon toegestaan.',
    };
  } catch {
    // Some browsers do not expose a microphone permission query at all. That is
    // not evidence either way, so the state stays unconfirmed rather than being
    // reported as working.
    return { usable: true, detail: 'Deze browser meldt de microfoontoestemming niet vooraf; de knop indrukken is de enige manier om het te weten.' };
  }
}

/**
 * Always-on wake word.
 *
 * Keeps recognition running and watches for the operator's name. Until the name
 * is heard nothing is sent anywhere: the transcript is examined in the page and
 * discarded. After the name, what follows is taken as the command.
 *
 * Recognition ends by itself constantly — on a pause, on silence, on an error —
 * so it is restarted rather than assumed to still be running. Without that the
 * system appears to be listening while it is deaf.
 */
export class WakeListener {
  #rec: SpeechRecognitionLike | null = null;
  #running = false;
  #stopped = true;
  #heard = '';
  #restart = 0;

  constructor(
    private readonly onWake: () => void,
    private readonly onCommand: (text: string) => void,
    private readonly onHear: (text: string) => void,
    private readonly onProblem: (reason: string) => void,
  ) {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = /^nl/i.test(navigator.language) ? navigator.language : 'nl-BE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last) return;
      const alt = last[0];
      if (!alt) return;
      this.#consider(alt.transcript, last.isFinal);
    };
    rec.onerror = (e) => {
      // 'no-speech' and 'aborted' are ordinary in a listener that runs all day.
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.onProblem(reasonFor(e.error));
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.stop();
    };
    rec.onend = () => {
      this.#running = false;
      if (!this.#stopped) this.#schedule();
    };
    this.#rec = rec;
  }

  get available(): boolean {
    return this.#rec !== null;
  }

  /** True while the recogniser is actually running, not merely wanted. */
  get live(): boolean {
    return this.#running;
  }

  start(): void {
    this.#stopped = false;
    this.#schedule(0);
  }

  stop(): void {
    this.#stopped = true;
    window.clearTimeout(this.#restart);
    try {
      this.#rec?.stop();
    } catch {
      /* Already stopped; nothing to undo. */
    }
  }

  #schedule(delay = 400): void {
    window.clearTimeout(this.#restart);
    this.#restart = window.setTimeout(() => {
      if (this.#stopped || this.#running || !this.#rec) return;
      try {
        this.#rec.start();
        this.#running = true;
      } catch {
        // Starting while it is already starting throws; the next end event
        // brings it back round.
      }
    }, delay);
  }

  #consider(transcript: string, final: boolean): void {
    const text = transcript.trim();
    if (!text) return;
    this.onHear(text);

    const wake = /\b(?:hey|hi|hallo|hé|he)?\s*jarvis\b/i.exec(text);
    if (!wake) return;

    // Everything after the name is the command. Nothing before it is used.
    const after = text.slice(wake.index + wake[0].length).replace(/^[\s,.:;!?-]+/, '');
    if (this.#heard !== text) {
      this.#heard = text;
      this.onWake();
    }
    if (final && after.length > 1) {
      this.#heard = '';
      this.onCommand(after);
    }
  }
}

export class Voice {
  #rec: SpeechRecognitionLike | null = null;
  #listening = false;

  constructor(private readonly onTranscript: (text: string, final: boolean) => void, private readonly onState: (listening: boolean) => void) {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = /^nl/i.test(navigator.language) ? navigator.language : 'nl-BE';
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

  #primed = false;
  #keepAlive: number | null = null;

  /**
   * Browsers load the voice list asynchronously and hand back an empty array
   * until it is ready. Speaking in that window is silently dropped — the call
   * succeeds and nothing is heard — so the first utterance waits for the list.
   */
  async #voices(): Promise<SpeechSynthesisVoice[]> {
    const now = window.speechSynthesis.getVoices();
    if (now.length) return now;
    return new Promise((resolve) => {
      const done = (): void => {
        window.clearTimeout(timer);
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices());
      };
      // Give up rather than hang: an empty list still speaks with the default.
      const timer = window.setTimeout(done, 1500);
      window.speechSynthesis.onvoiceschanged = done;
    });
  }

  /**
   * Browsers refuse to speak until the page has been interacted with, and they
   * refuse silently. Called on the first real gesture, this spends that gesture
   * on an inaudible utterance so the first thing JARVIS actually says is heard.
   */
  prime(): void {
    if (this.#primed || typeof window.speechSynthesis === 'undefined') return;
    this.#primed = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  /** Speaks a reply back. Kept short and interruptible. */
  say(text: string): void {
    if (typeof window.speechSynthesis === 'undefined') return;
    const spoken = text.replace(/\s+/g, ' ').trim().slice(0, 320);
    if (!spoken) return;

    void (async () => {
      try {
        await this.#speak(spoken);
      } catch (err) {
        // An unhandled rejection here is silence with no explanation, which is
        // the failure this whole path exists to avoid.
        this.onProblem?.(`The browser could not speak the reply: ${(err as Error).message}`);
        this.onSpeaking?.(false);
      }
    })();
  }

  async #speak(spoken: string): Promise<void> {
    {
      const voices = await this.#voices();
      // cancel() then speak() in the same tick leaves Chrome's queue wedged and
      // nothing is heard; the gap between them is what makes this reliable.
      window.speechSynthesis.cancel();
      await new Promise((r) => window.setTimeout(r, 60));

      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = 'nl-BE';
      u.rate = 1.02;
      u.pitch = 0.94;
      const preferred =
        voices.find((v) => /^nl-BE/i.test(v.lang)) ??
        voices.find((v) => /^nl/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang));
      // Choosing a voice is a preference, never a precondition: if the browser
      // rejects the assignment, it still speaks in its default voice.
      try {
        if (preferred) u.voice = preferred;
      } catch {
        /* keep the default voice */
      }

      // The interface reports speaking only while the engine reports it, so the
      // indicator follows the voice rather than predicting it.
      u.onstart = () => {
        this.onSpeaking?.(true);
        // Chrome stops mid-sentence after about fifteen seconds unless nudged.
        this.#keepAlive = window.setInterval(() => window.speechSynthesis.resume(), 5000);
      };
      const finish = (): void => {
        if (this.#keepAlive !== null) window.clearInterval(this.#keepAlive);
        this.#keepAlive = null;
        this.onSpeaking?.(false);
      };
      u.onend = finish;
      u.onerror = (e) => {
        finish();
        // Failing silently is what made this hard to diagnose; say why.
        const reason = (e as SpeechSynthesisErrorEvent).error ?? 'unknown';
        if (reason !== 'interrupted' && reason !== 'canceled') {
          this.onProblem?.(SPEECH_REASONS[reason] ?? `The browser could not speak the reply: ${reason}.`);
        }
      };
      window.speechSynthesis.speak(u);
    }
  }

  silence(): void {
    if (this.#keepAlive !== null) window.clearInterval(this.#keepAlive);
    this.#keepAlive = null;
    if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
    this.onSpeaking?.(false);
  }
}
