// i18n-ignore-file: no message of Petto is written here; the texts are shown by the hooks of the caller.
// The queue and the player of one server. It knows nothing of Discord: it is given a player (the one of Shoukaku, or a stand-in in the checks) and
// `recordingsFor(item)`, and it tells what happens through `hooks` (a track starts, a track failed, the queue ended). Whatever goes wrong with a
// recording, the next one of the same song is tried before the song is skipped, and a run of failures stops the player instead of looping forever.

const MAX_FAILURES = 5; // songs in a row that could not be played
const HISTORY = 20;
const MAX_VOLUME = 150;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

class GuildMusic {
  /**
   * @param {{ guildId: string, player: object, recordingsFor: (item: object) => Promise<string[]>, hooks?: object, now?: () => number, maxQueue?: number }} options
   */
  constructor({ guildId, player, recordingsFor, hooks = {}, now = Date.now, maxQueue = 200 }) {
    this.guildId = guildId;
    this.player = player;
    this.recordingsFor = recordingsFor;
    this.hooks = hooks;
    this.now = now;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.history = [];
    this.current = null;
    this.loop = 'off'; // 'off' | 'track' | 'queue'
    this.volume = 100;
    this.paused = false;
    this.failures = 0;
    this.playing = null; // the recording loaded in the player
    this.position = { at: 0, ms: 0 };
    this.stuckAt = 0;
    this.lastException = null;
    this.destroyed = false;
    this.listeners = [];
    this.bind();
  }

  bind() {
    const on = (event, handler) => { this.player.on(event, handler); this.listeners.push([event, handler]); };
    on('end', (event) => { this.onEnd(event).catch((error) => this.hooks.onError?.(this, error)); });
    on('stuck', () => { this.onStuck().catch((error) => this.hooks.onError?.(this, error)); });
    on('exception', (event) => { this.lastException = event?.exception ?? null; this.hooks.onException?.(this, event); });
    on('start', (event) => {
      if (event?.track?.encoded && event.track.encoded !== this.playing) return; // the start of a recording that is not the one loaded
      this.failures = 0;
      if (this.current) this.hooks.onTrackStart?.(this, this.current); // told when Lavalink really has it, not when it was asked to (a recording can fail to load)
    });
    on('update', (update) => { if (Number.isFinite(update?.state?.position)) this.mark(update.state.position); });
    on('closed', (event) => this.hooks.onClosed?.(this, event));
  }

  destroy() {
    this.destroyed = true;
    for (const [event, handler] of this.listeners) this.player.off?.(event, handler);
    this.listeners = [];
  }

  /** Where the song is, in milliseconds: the last position Lavalink told, plus the time since (nothing while paused). */
  positionMs() {
    const base = this.position.ms + (this.paused || !this.current ? 0 : this.now() - this.position.at);
    const length = this.current?.lengthMs || Infinity;
    return clamp(base, 0, length);
  }

  mark(ms) { this.position = { at: this.now(), ms }; }

  get size() { return this.queue.length; }

  /** Adds songs at the end (or at the front with `next`). Returns how many fit and the place of the first one. */
  add(items, { next = false } = {}) {
    const room = Math.max(0, this.maxQueue - this.queue.length);
    const taken = items.slice(0, room);
    if (!taken.length) return { added: 0, position: 0, full: true };
    if (next) this.queue.unshift(...taken); else this.queue.push(...taken);
    return { added: taken.length, position: next ? 1 : this.queue.length - taken.length + 1, full: taken.length < items.length };
  }

  /** Starts playing when nothing is. */
  async startIfIdle() {
    if (this.current || this.destroyed) return false;
    return this.playNext();
  }

  async playNext({ skipped = false } = {}) {
    if (this.destroyed) return false;
    let item = null;
    if (this.current && this.loop === 'track' && !skipped) {
      item = this.current;
    } else {
      if (this.current) {
        this.history.push(this.current);
        if (this.history.length > HISTORY) this.history.shift();
        if (this.loop === 'queue') this.queue.push(this.current);
      }
      item = this.queue.shift() ?? null;
    }
    this.current = item;
    this.playing = null;
    if (!item) {
      this.mark(0);
      this.hooks.onQueueEnd?.(this);
      return false;
    }
    item.index = 0;
    try {
      item.list ??= await this.recordingsFor(item);
    } catch {
      item.list = [];
    }
    if (!item.list.length) return this.fail(item, 'notFound');
    return this.playRecording(item);
  }

  async playRecording(item) {
    if (this.destroyed || this.current !== item) return false;
    const encoded = item.list[item.index];
    const wasPaused = this.paused;
    this.playing = encoded; // before asking: the start event can arrive before the answer
    item.encoded = encoded;
    this.paused = false;
    this.mark(0);
    try {
      await this.player.playTrack({ track: { encoded } });
      if (wasPaused) await this.player.setPaused(false); // a new song plays even if the last one was paused
    } catch (error) {
      if (this.playing === encoded) this.playing = null;
      return this.retry(item, error?.message ?? 'playFailed');
    }
    this.prefetch();
    return true;
  }

  /** The next recording of the same song, or the next song when there is none. */
  async retry(item, error) {
    if (this.current !== item) return false;
    if (item.list && item.index + 1 < item.list.length) {
      item.index += 1;
      return this.playRecording(item);
    }
    return this.fail(item, error);
  }

  async fail(item, error) {
    this.failures += 1;
    this.hooks.onTrackFailed?.(this, item, error);
    if (this.current === item) this.current = null; // a song that cannot play is not put in the history, nor back in a looped queue
    if (this.failures >= MAX_FAILURES) {
      this.hooks.onGiveUp?.(this);
      await this.stop();
      return false;
    }
    return this.playNext({ skipped: true });
  }

  /** The recording of the next song is chosen while this one plays, so there is no wait between them. */
  prefetch() {
    const next = this.queue[0];
    if (!next || next.list) return;
    next.list = null;
    Promise.resolve(this.recordingsFor(next)).then((list) => { if (!next.list) next.list = list; }).catch(() => {});
  }

  async onEnd(event) {
    if (this.destroyed || !this.current) return;
    if (event.reason === 'finished') {
      if (event.track?.encoded && event.track.encoded !== this.playing) return; // the end of a track that is not the one playing (the one that was replaced)
      if (this.now() - this.stuckAt < 3000) return; // a track that was stuck was already moved on from
      await this.playNext();
    } else if (event.reason === 'loadFailed') {
      if (event.track?.encoded && event.track.encoded !== this.playing) return;
      const reason = this.lastException?.message ?? 'loadFailed'; // what Lavalink said (it sends the exception just before this end)
      this.lastException = null;
      await this.retry(this.current, reason);
    } // 'stopped', 'replaced' and 'cleanup' come from what this object did itself
  }

  async onStuck() {
    if (this.destroyed || !this.current) return;
    this.stuckAt = this.now();
    await this.retry(this.current, 'stuck');
  }

  async skip(count = 1) {
    const extra = clamp(Math.floor(count) - 1, 0, this.queue.length);
    if (extra) this.history.push(...this.queue.splice(0, extra));
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    return this.playNext({ skipped: true });
  }

  async previous() {
    const before = this.history.pop();
    if (!before) return false;
    if (this.current) this.queue.unshift(this.current);
    this.queue.unshift(before);
    this.current = null;
    return this.playNext({ skipped: true });
  }

  async pause() {
    if (!this.current || this.paused) return false;
    this.mark(this.positionMs());
    this.paused = true;
    await this.player.setPaused(true);
    return true;
  }

  async resume() {
    if (!this.current || !this.paused) return false;
    this.paused = false;
    this.mark(this.position.ms);
    await this.player.setPaused(false);
    return true;
  }

  async seek(ms) {
    if (!this.current || this.current.lengthMs <= 0) return false;
    const target = clamp(Math.floor(ms), 0, this.current.lengthMs - 1000);
    await this.player.seekTo(target);
    this.mark(target);
    return true;
  }

  async setVolume(percent) {
    this.volume = clamp(Math.round(percent), 1, MAX_VOLUME);
    await this.player.setGlobalVolume(this.volume);
    return this.volume;
  }

  setLoop(mode) {
    this.loop = ['off', 'track', 'queue'].includes(mode) ? mode : 'off';
    return this.loop;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    return this.queue.length;
  }

  /** Takes the song at `place` (1 is the next one) out of the queue. */
  remove(place) {
    const index = Math.floor(place) - 1;
    if (!(index >= 0 && index < this.queue.length)) return null;
    return this.queue.splice(index, 1)[0];
  }

  clear() {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  async stop() {
    this.queue = [];
    this.current = null;
    this.playing = null;
    this.paused = false;
    this.mark(0);
    try { await this.player.stopTrack(); } catch { /* the player may be gone already */ }
    this.hooks.onStopped?.(this);
  }
}

module.exports = { GuildMusic, MAX_FAILURES, MAX_VOLUME };
