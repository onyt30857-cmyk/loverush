/**
 * Admin · 群发列表 · M13 Phase 0
 *
 * 显示所有群发批次 + 状态 + 投递统计
 * 操作:详情 + 发送(草稿才能点)+ 删除(草稿才能点)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Broadcast {
  id: string;
  name: string;
  title: string;
  level: string;
  category: string;
  audienceCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_BADGE: Record<Broadcast['status'], string> = {
  draft: 'bg-ink-100 text-ink-700',
  sending: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<Broadcast['status'], string> = {
  draft: '草稿',
  sending: '发送中',
  completed: '已完成',
  failed: '失败',
};

export default function BroadcastsPage() {
  const [list, setList] = useState<Broadcast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'' | Broadcast['status']>('');

  async function load() {
    try {
      const path = filter ? `/admin/broadcasts?status=${filter}` : '/admin/broadcasts';
      setList(await api.get<Broadcast[]>(path));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  async function send(id: string, audienceCount: number) {
    if (!confirm(`将发送给 ${audienceCount} 位用户 · 不可撤回 · 是否继续？`)) return;
    try {
      await api.post(`/admin/broadcasts/${id}/send`);
      await load();
      // 5 秒后再刷一次看完成状态
      setTimeout(() => void load(), 5_000);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function del(id: string) {
    if (!confirm('确定删除此草稿？')) return;
    try {
      await api.delete(`/admin/broadcasts/${id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">📣 群发列表</h1>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Broadcast['status'] | '')}
            className="input h-9 text-sm"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="sending">发送中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select>
          <Link href="/broadcasts/new" className="btn-primary">
            + 新建群发
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>标题</th>
              <th>分级</th>
              <th>类别</th>
              <th>状态</th>
              <th>受众</th>
              <th>已发</th>
              <th>跳过</th>
              <th>失败</th>
              <th>创建</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-ink-500">
                  还没有群发记录 · 点 + 新建
                </td>
              </tr>
            )}
            {list.map((b) => (
              <tr key={b.id}>
                <td className="font-mono text-xs">{b.name}</td>
                <td className="max-w-[180px] truncate">{b.title}</td>
                <td className="text-xs">{b.level}</td>
                <td className="text-xs">{b.category}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[b.status]}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                </td>
                <td className="font-mono">{b.audienceCount}</td>
                <td className="font-mono text-green-700">{b.sentCount}</td>
                <td className="font-mono text-ink-500">{b.skippedCount}</td>
                <td className="font-mono text-red-700">{b.failedCount}</td>
                <td className="text-xs">{new Date(b.createdAt).toLocaleString()}</td>
                <td className="space-x-1 text-right">
                  <Link href={`/broadcasts/${b.id}`} className="btn-ghost h-7 px-3 text-xs">
                    详情
                  </Link>
                  {b.status === 'draft' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void send(b.id, b.audienceCount)}
                        className="btn-primary h-7 px-3 text-xs"
                      >
                        发送
                      </button>
                      <button
                        type="button"
                        onClick={() => void del(b.id)}
                        className="btn-ghost h-7 px-3 text-xs text-red-600"
                      >
                        删除
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
