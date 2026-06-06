/**
 * 技师新订单语音播报(H5 · 前台)
 *
 * - 开关存 localStorage(纯客户端,零后端);默认关。
 * - 音源:优先播预录音 /sounds/new-order.mp3(各浏览器最稳);加载/播放失败 → Web Audio 合成提示音兜底,永不静默。
 * - H5 自动播放限制:浏览器禁止"无用户操作就放声"。开关"开启"那一下点击就是用户操作 →
 *   primeOrderVoice() 在该手势里解锁音频(resume AudioContext + 静音预热 audio),之后才能在收到 SSE 时自动播。
 */

const STORAGE_KEY = 'tech_order_voice_enabled';
const CLIP_URL = '/sounds/new-order.mp3';

export function isOrderVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

export function setOrderVoiceEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
}

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

function getAudioEl(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio(CLIP_URL);
    audioEl.preload = 'auto';
  }
  return audioEl;
}

/** 合成"叮咚"提示音(无需任何音频文件,解锁后各浏览器都能响)· 预录音失败时兜底。 */
function playChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    void audioCtx.resume();
    const now = audioCtx.currentTime;
    // 两声:高→低,像门铃
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    });
  } catch {
    /* 合成也失败就算了,不抛 */
  }
}

/**
 * 在用户手势里调用一次(开关开启时)· 解锁音频:
 *  - 创建/resume AudioContext;
 *  - 把 audio 元素静音播一下再暂停(满足 iOS"必须由手势触发过 play")。
 */
export function primeOrderVoice(): void {
  if (typeof window === 'undefined') return;
  // 只解锁 AudioContext(合成提示音用)· 绝不在这里静音预热 audio 元素 ——
  // 否则会和紧跟其后的 playNewOrderAlert() 试听抢同一个元素,试听那刻还静音着=没声(关了再开无声的根因)。
  // audio 元素的解锁交给 playNewOrderAlert():它在开关点击(用户手势)里 unmuted 直接 play,既试听又解锁后续自动播。
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audioCtx) audioCtx = new Ctx();
    void audioCtx?.resume();
  } catch { /* ignore */ }
}

/** 收到新订单时调用:开关开才播。先试预录音,失败兜底合成提示音。 */
export function playNewOrderAlert(): void {
  if (typeof window === 'undefined') return;
  if (!isOrderVoiceEnabled()) return;
  try {
    const el = getAudioEl();
    el.currentTime = 0;
    void el.play().catch(() => playChime()); // 文件缺失(mp3 未生成)/未解锁 → 合成提示音兜底
  } catch {
    playChime();
  }
}
