'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { TherapistShell } from '@/components/AppShell';
import { Avatar } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
}

// H1.T 修复 · §4/§8：
// ① 容器整页 bg-gradient-soft 消除色硬切
// ② 空态补四件套：icon + 主文 + 辅助文 + 次级动作（完善档案 → 提升被挑中概率）
// ③ 数据未到不再 LoadingFull 阻塞，进页立即显容器，列表区显占位
export default function TherapistMessagesPage() {
  const [list, setList] = useState<Conv[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Conv[]>('/conversations');
        setList(data);
      } catch {
        setList([]); // API 失败也退出 loading，进入空状态而非永久白屏
      }
    })();
  }, []);

  return (
    <TherapistShell>
      <div className="min-h-full bg-gradient-soft">
        {list === null ? (
          // 数据未到：显占位（与最终列表相同高度，避免 layout shift）
          <ul className="space-y-2 px-5 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 shadow-warm-xs"
              >
                <div className="h-12 w-12 shrink-0 rounded-full bg-warm-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-warm-100" />
                  <div className="h-3 w-2/3 rounded bg-warm-100/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.length === 0 ? (
          // §8 四件套：icon + 主文 + 辅文 + 次级动作（不是死巷）
          <div className="mt-12 flex flex-col items-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-warm-sm">
              <MessageCircle className="h-7 w-7 text-primary" />
            </div>
            <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">
              还没有会话
            </div>
            <div className="mt-1.5 text-[12px] leading-5 text-ink-500">
              客户来咨询后，对话会出现在这里
            </div>
            <Link
              href="/t/me/profile"
              className="mt-4 inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[12px] text-ink-700 shadow-warm-xs active:scale-95"
            >
              完善档案 · 提升被挑中概率 →
            </Link>
          </div>
        ) : (
          <ul className="space-y-2 px-5 py-4">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/t/messages/${c.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-warm-xs transition active:scale-[0.99]"
                >
                  <Avatar size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-800">客户 #{c.customerId.slice(0, 8)}</div>
                    <div className="text-xs text-ink-500">
                      {c.messageCount} 条 · {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : '尚无消息'}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TherapistShell>
  );
}
