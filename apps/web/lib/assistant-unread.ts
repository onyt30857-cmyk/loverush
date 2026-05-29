/**
 * AI 助理未读标记 · 工具函数
 *
 * 给业务侧调用:来了新消息标记未读 / 进入对话清掉。
 * 历史上挂在 AssistantFab.tsx 内,FAB 移除后(用户反馈"不要悬浮按钮"),
 * 工具函数独立保留,后续如要重新挂未读提示可在底部 nav 中央按钮加 badge。
 */
export function markAssistantUnread(unread: boolean): void {
  if (typeof window === 'undefined') return;
  if (unread) {
    window.localStorage.setItem('assistant_unread', '1');
  } else {
    window.localStorage.removeItem('assistant_unread');
  }
}

export function hasAssistantUnread(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('assistant_unread') === '1';
  } catch {
    return false;
  }
}
