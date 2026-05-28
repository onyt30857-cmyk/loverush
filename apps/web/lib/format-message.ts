/**
 * AI 助理消息格式化 · 剥离 markdown + 自然分段
 *
 * 痛点:即使 PRD §5 voice 规则说"私聊禁 markdown",AI 偶尔还是输出 `**` `-` 等标记。
 *      前端做兜底处理,确保气泡视觉干净。
 *
 * 处理顺序:
 *   1. 剥粗体标记:`**xxx**` → `xxx`(保留为 bold span 段)
 *   2. 剥斜体标记:`*xxx*` / `_xxx_` → `xxx`
 *   3. 剥标题:`# / ## / ###` 标记去掉(标题文字保留为 bold 段)
 *   4. 列表项 `- xxx` / `* xxx` → 改为换行 + `· xxx`(更柔和)
 *   5. 数字列表 `1. xxx` 保留(数字本身有意义)
 *   6. 连续换行合并:≥3 个换行 → 2 个(避免大空白)
 *
 * 输出:Array<MessageSegment> 给 UI 渲染
 */

export type MessageSegment =
  | { type: 'paragraph'; text: string; bold?: boolean }
  | { type: 'list_item'; text: string }
  | { type: 'spacer' };

/** 单段文本内的 inline markdown 剥离 */
function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1') // **粗体** → 粗体
    .replace(/__(.+?)__/g, '$1')      // __粗体__ → 粗体
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1') // *斜体* → 斜体
    .replace(/(?<!_)_(?!_)([^_\n]+)_(?!_)/g, '$1')      // _斜体_ → 斜体
    .replace(/`([^`]+)`/g, '$1')      // `code` → code
    .trim();
}

/**
 * 解析 AI 消息为段落数组 · 自然分段渲染用
 */
export function formatAssistantMessage(raw: string): MessageSegment[] {
  if (!raw) return [];

  // 1. 行级处理
  const lines = raw.split(/\r?\n/);
  const segments: MessageSegment[] = [];
  let buffer: string[] = [];

  const flushBuffer = (bold = false) => {
    const text = stripInline(buffer.join(' ').trim());
    if (text) segments.push({ type: 'paragraph', text, bold });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 空行 → flush buffer + spacer(段间距)
    if (!line) {
      if (buffer.length) flushBuffer();
      // 只在前一段不是 spacer 时加 spacer(防多个 spacer 连续)
      if (segments.length && segments[segments.length - 1]!.type !== 'spacer') {
        segments.push({ type: 'spacer' });
      }
      continue;
    }

    // 列表项 - / * / + 开头
    const listMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (listMatch) {
      if (buffer.length) flushBuffer();
      segments.push({ type: 'list_item', text: stripInline(listMatch[1]!) });
      continue;
    }

    // 标题 # / ## / ### → 当粗体段
    const headerMatch = /^#{1,4}\s+(.+)$/.exec(line);
    if (headerMatch) {
      if (buffer.length) flushBuffer();
      segments.push({ type: 'paragraph', text: stripInline(headerMatch[1]!), bold: true });
      continue;
    }

    // 整行 **xxx** 单独成行 → 当粗体段
    const wholeBoldMatch = /^\*\*(.+)\*\*$/.exec(line);
    if (wholeBoldMatch) {
      if (buffer.length) flushBuffer();
      segments.push({ type: 'paragraph', text: stripInline(wholeBoldMatch[1]!), bold: true });
      continue;
    }

    // 普通行 → 累积到 buffer
    buffer.push(line);
  }

  // 末尾 flush
  if (buffer.length) flushBuffer();

  // 去掉首尾 spacer
  while (segments.length && segments[0]!.type === 'spacer') segments.shift();
  while (segments.length && segments[segments.length - 1]!.type === 'spacer') segments.pop();

  return segments;
}
