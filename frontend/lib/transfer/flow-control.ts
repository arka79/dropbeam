export class FlowController {
  readonly highWaterMark: number;
  readonly lowWaterMark: number;
  private resumeResolvers: Array<() => void> = [];
  private _paused = false;

  constructor(highWaterMark = 8 * 1024 * 1024, lowWaterMark = 2 * 1024 * 1024) {
    this.highWaterMark = highWaterMark;
    this.lowWaterMark = lowWaterMark;
  }

  get paused() {
    return this._paused;
  }

  consider(bufferedAmount: number): boolean {
    if (!this._paused && bufferedAmount > this.highWaterMark) {
      this._paused = true;
      return false;
    }
    if (this._paused && bufferedAmount <= this.lowWaterMark) {
      this._paused = false;
      const resolvers = this.resumeResolvers.splice(0);
      for (const r of resolvers) r();
    }
    return !this._paused;
  }

  forceResume() {
    if (!this._paused) return;
    this._paused = false;
    const resolvers = this.resumeResolvers.splice(0);
    for (const r of resolvers) r();
  }

  async waitForResume(): Promise<void> {
    if (!this._paused) return;
    return new Promise<void>((resolve) => this.resumeResolvers.push(resolve));
  }

  reset() {
    this._paused = false;
    this.resumeResolvers = [];
  }
}

export function attachBufferEvents(
  channel: RTCDataChannel,
  controller: FlowController,
  onUpdate?: (buffered: number) => void,
) {
  const handle = () => {
    const ok = controller.consider(channel.bufferedAmount);
    onUpdate?.(channel.bufferedAmount);
    if (ok && channel.bufferedAmount <= controller.lowWaterMark) {
      channel.dispatchEvent(new Event('flow-resume'));
    }
  };
  channel.addEventListener('bufferedamountlow', handle);
  channel.bufferedAmountLowThreshold = controller.lowWaterMark;
  return () => channel.removeEventListener('bufferedamountlow', handle);
}
