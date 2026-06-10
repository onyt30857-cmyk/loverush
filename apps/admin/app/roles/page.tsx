'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface RoleCatalogItem {
  key: string;
  name_zh: string;
  is_system: boolean;
  permissionCount: number;
  userCount: number;
}

interface PermCatalogItem {
  key: string;
  label: string;
  group: string;
  navHref: string | null;
  apiPrefixes: string[];
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const KEY_RE = /^[a-z0-9_]+$/;

// ── 主页面 ─────────────────────────────────────────────────────────────────────

export default function RolesPage() {
  // ---- 数据 ----
  const [roles, setRoles] = useState<RoleCatalogItem[]>([]);
  const [permCatalog, setPermCatalog] = useState<PermCatalogItem[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ---- 选中角色 ----
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedRole = roles.find((r) => r.key === selectedKey) ?? null;

  // ---- 新建角色弹层 ----
  const [showCreate, setShowCreate] = useState(false);

  // ---- 改名弹层 ----
  const [editingRole, setEditingRole] = useState<RoleCatalogItem | null>(null);

  // ---- 删除确认 ----
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ─── 加载角色目录 ─────────────────────────────────────────────────────────────

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const data = await api.get<RoleCatalogItem[]>('/admin/roles/catalog');
      setRoles(data);
    } catch (err) {
      setGlobalError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  const loadPermCatalog = useCallback(async () => {
    setLoadingPerms(true);
    try {
      const data = await api.get<PermCatalogItem[]>('/admin/permissions/catalog');
      setPermCatalog(data);
    } catch (err) {
      setGlobalError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoadingPerms(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
    void loadPermCatalog();
  }, [loadRoles, loadPermCatalog]);

  // ─── 删除角色 ─────────────────────────────────────────────────────────────────

  async function handleDelete(key: string) {
    setDeleteLoading(true);
    try {
      await api.delete(`/admin/roles/catalog/${key}`);
      setDeletingKey(null);
      if (selectedKey === key) setSelectedKey(null);
      await loadRoles();
    } catch (err) {
      setGlobalError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl">
        {/* 页头 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">账号角色</h1>
            <p className="mt-1 text-sm text-ink-400">管理后台角色与权限矩阵，系统角色名称可改但不可删除</p>
          </div>
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
            + 新建角色
          </button>
        </div>

        {globalError && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {globalError}
            <button type="button" onClick={() => setGlobalError(null)} className="ml-3 text-rose-400 hover:text-rose-600">✕</button>
          </div>
        )}

        <div className="grid grid-cols-[320px_1fr] gap-5">
          {/* ── 左栏:角色列表 ─────────────────────────────────────────── */}
          <div className="space-y-2">
            {loadingRoles ? (
              <div className="card py-8 text-center text-sm text-ink-400">加载中…</div>
            ) : (
              roles.map((r) => (
                <RoleCard
                  key={r.key}
                  role={r}
                  selected={selectedKey === r.key}
                  onSelect={() => setSelectedKey(r.key)}
                  onEdit={() => setEditingRole(r)}
                  onDelete={() => setDeletingKey(r.key)}
                />
              ))
            )}
          </div>

          {/* ── 右栏:权限矩阵 + 用户分配 ─────────────────────────────── */}
          <div className="space-y-5">
            {selectedRole ? (
              <>
                <PermMatrix
                  role={selectedRole}
                  permCatalog={permCatalog}
                  loadingCatalog={loadingPerms}
                />
                <UserAssign role={selectedRole} onReload={loadRoles} />
              </>
            ) : (
              <div className="card flex items-center justify-center py-16 text-sm text-ink-400">
                ← 选择一个角色查看权限矩阵与用户分配
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新建角色弹层 */}
      {showCreate && (
        <CreateRoleModal
          onClose={() => setShowCreate(false)}
          onCreated={async (key) => {
            setShowCreate(false);
            await loadRoles();
            setSelectedKey(key);
          }}
        />
      )}

      {/* 改名弹层 */}
      {editingRole && (
        <EditRoleModal
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={async () => {
            setEditingRole(null);
            await loadRoles();
          }}
        />
      )}

      {/* 删除确认弹层 */}
      {deletingKey && (
        <ConfirmModal
          title="删除角色"
          message={`确认删除角色「${deletingKey}」？此操作不可撤销。仅无持有人的自定义角色可删除。`}
          confirmLabel="确认删除"
          danger
          loading={deleteLoading}
          onConfirm={() => void handleDelete(deletingKey)}
          onCancel={() => setDeletingKey(null)}
        />
      )}
    </AdminShell>
  );
}

// ── 角色卡片 ──────────────────────────────────────────────────────────────────

function RoleCard({
  role,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  role: RoleCatalogItem;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={`card cursor-pointer transition-all ${
        selected ? 'border-primary/40 ring-1 ring-primary/30' : 'hover:border-ink-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink-900">{role.name_zh}</span>
            {role.is_system ? (
              <span className="shrink-0 rounded-full bg-ink-100 px-2 py-px text-[10px] font-medium text-ink-500">
                系统
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">
                自定义
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-400">{role.key}</div>
          <div className="mt-1.5 flex gap-3 text-[11px] text-ink-400">
            <span>{role.permissionCount} 项权限</span>
            <span>{role.userCount} 个成员</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onEdit}
            className="btn-ghost h-7 px-2.5 text-xs"
          >
            改名
          </button>
          {!role.is_system && (
            <button
              type="button"
              onClick={onDelete}
              className="h-7 rounded-lg px-2.5 text-xs text-rose-500 transition-colors hover:bg-rose-50"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 权限矩阵 ──────────────────────────────────────────────────────────────────

function PermMatrix({
  role,
  permCatalog,
  loadingCatalog,
}: {
  role: RoleCatalogItem;
  permCatalog: PermCatalogItem[];
  loadingCatalog: boolean;
}) {
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [loadingRolePerms, setLoadingRolePerms] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // 按 group 聚合权限目录
  const groups = useMemo(() => {
    const map = new Map<string, PermCatalogItem[]>();
    for (const p of permCatalog) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [permCatalog]);

  // 拉取该角色当前权限
  useEffect(() => {
    setLoadingRolePerms(true);
    setSaveOk(false);
    setSaveError(null);
    void (async () => {
      try {
        const data = await api.get<string[]>(`/admin/roles/catalog/${role.key}/permissions`);
        setRolePerms(new Set(data));
      } catch {
        setRolePerms(new Set());
      } finally {
        setLoadingRolePerms(false);
      }
    })();
  }, [role.key]);

  // admin 角色只读
  const isAdmin = role.key === 'admin';

  function toggle(permKey: string) {
    if (isAdmin) return;
    setRolePerms((prev) => {
      const next = new Set(prev);
      if (next.has(permKey)) next.delete(permKey);
      else next.add(permKey);
      return next;
    });
    setSaveOk(false);
  }

  function toggleGroup(items: PermCatalogItem[], allChecked: boolean) {
    if (isAdmin) return;
    setRolePerms((prev) => {
      const next = new Set(prev);
      for (const p of items) {
        if (allChecked) next.delete(p.key);
        else next.add(p.key);
      }
      return next;
    });
    setSaveOk(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await api.put(`/admin/roles/catalog/${role.key}/permissions`, {
        permission_keys: Array.from(rolePerms),
      });
      setSaveOk(true);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const isLoading = loadingCatalog || loadingRolePerms;

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900">
          权限矩阵 · {role.name_zh}
        </h2>
        {isAdmin ? (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            超级管理员 · 全部权限 · 只读
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {saveOk && <span className="text-xs text-green-600">已保存</span>}
            {saveError && <span className="text-xs text-rose-500">{saveError}</span>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || isLoading}
              className="btn-primary h-8 px-4 text-xs disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存权限'}
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-ink-400">加载中…</div>
      ) : isAdmin ? (
        <div className="rounded-lg bg-amber-50/60 px-4 py-3 text-sm text-amber-700">
          超级管理员拥有全部 {permCatalog.length} 项权限，无法通过界面修改。如需调整，请联系开发团队。
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ group, items }) => {
            const checkedCount = items.filter((p) => rolePerms.has(p.key)).length;
            const allChecked = checkedCount === items.length;
            const someChecked = checkedCount > 0 && checkedCount < items.length;

            return (
              <PermGroup
                key={group}
                group={group}
                items={items}
                rolePerms={rolePerms}
                allChecked={allChecked}
                someChecked={someChecked}
                checkedCount={checkedCount}
                onToggleGroup={() => toggleGroup(items, allChecked)}
                onTogglePerm={toggle}
                readonly={isAdmin}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 权限分组折叠块 ────────────────────────────────────────────────────────────

function PermGroup({
  group,
  items,
  rolePerms,
  allChecked,
  someChecked,
  checkedCount,
  onToggleGroup,
  onTogglePerm,
  readonly,
}: {
  group: string;
  items: PermCatalogItem[];
  rolePerms: Set<string>;
  allChecked: boolean;
  someChecked: boolean;
  checkedCount: number;
  onToggleGroup: () => void;
  onTogglePerm: (key: string) => void;
  readonly: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-ink-100">
      {/* 组头 */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-ink-50"
        onClick={() => setOpen((v) => !v)}
      >
        {/* 组级全选 checkbox */}
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          disabled={readonly}
          onChange={onToggleGroup}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed"
        />
        <span className="flex-1 text-[13px] font-medium text-ink-700">{group}</span>
        <span className="text-[11px] text-ink-400">
          {checkedCount}/{items.length}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 shrink-0 text-ink-300 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>

      {/* 展开项列表 */}
      {open && (
        <div className="border-t border-ink-100 px-4 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {items.map((p) => (
              <label
                key={p.key}
                className={`flex items-center gap-2 ${readonly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={rolePerms.has(p.key)}
                  disabled={readonly}
                  onChange={() => onTogglePerm(p.key)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="text-[12px] text-ink-600">{p.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 用户分配 ──────────────────────────────────────────────────────────────────

function UserAssign({
  role,
  onReload,
}: {
  role: RoleCatalogItem;
  onReload: () => Promise<void>;
}) {
  const [users, setUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantId, setGrantId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<string[]>(`/admin/roles/${role.key}/users`);
      setUsers(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [role.key]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function grant() {
    const id = grantId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/roles', { user_id: id, role: role.key });
      setGrantId('');
      await loadUsers();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/admin/roles', { user_id: userId, role: role.key, reason: 'admin revoke' });
      await loadUsers();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900">
        用户分配 · {role.name_zh}
      </h2>

      {error && (
        <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {/* 赋权输入行 */}
      <div className="mb-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="输入 user_id (UUID)"
          value={grantId}
          onChange={(e) => setGrantId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void grant()}
        />
        <button
          type="button"
          onClick={() => void grant()}
          disabled={!grantId.trim() || busy}
          className="btn-primary px-4 disabled:opacity-50"
        >
          赋权
        </button>
      </div>

      {/* 持有人列表 */}
      {loading ? (
        <div className="text-sm text-ink-400">加载中…</div>
      ) : users.length === 0 ? (
        <div className="rounded-lg bg-ink-50 py-4 text-center text-sm text-ink-400">
          暂无用户持有此角色
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="mb-2 text-xs text-ink-400">持有人 · {users.length} 人</div>
          {users.map((uid) => (
            <div
              key={uid}
              className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2"
            >
              <span className="font-mono text-[12px] text-ink-700">{uid}</span>
              <button
                type="button"
                onClick={() => void revoke(uid)}
                disabled={busy}
                className="text-xs text-rose-500 transition-colors hover:text-rose-700 disabled:opacity-40"
              >
                撤销
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 新建角色弹层 ──────────────────────────────────────────────────────────────

function CreateRoleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ key: '', name_zh: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyValid = KEY_RE.test(form.key);
  const canSubmit = form.key.length > 0 && form.name_zh.trim().length > 0 && keyValid;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/roles/catalog', {
        key: form.key,
        name_zh: form.name_zh.trim(),
        description: form.description.trim() || undefined,
      });
      await onCreated(form.key);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="新建角色" onClose={onClose}>
      <div className="space-y-3">
        <FormField label="角色 Key（小写字母/数字/下划线，创建后不可改）">
          <input
            className={`input w-full ${form.key && !keyValid ? 'border-rose-300' : ''}`}
            placeholder="例如：finance_manager"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
          />
          {form.key && !keyValid && (
            <p className="mt-1 text-xs text-rose-500">只允许小写字母、数字、下划线</p>
          )}
        </FormField>

        <FormField label="中文名称">
          <input
            className="input w-full"
            placeholder="例如：财务经理"
            value={form.name_zh}
            onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
          />
        </FormField>

        <FormField label="描述（可选）">
          <textarea
            className="h-20 w-full rounded-lg border border-ink-200 p-3 text-sm focus:border-primary focus:outline-none"
            placeholder="角色职责说明…"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      </div>

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="btn-ghost flex-1">
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {busy ? '创建中…' : '创建角色'}
        </button>
      </div>
    </Modal>
  );
}

// ── 改名弹层 ──────────────────────────────────────────────────────────────────

function EditRoleModal({
  role,
  onClose,
  onSaved,
}: {
  role: RoleCatalogItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [nameZh, setNameZh] = useState(role.name_zh);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = nameZh.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/roles/catalog/${role.key}`, {
        name_zh: trimmed,
        description: description.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`修改角色 · ${role.key}`} onClose={onClose}>
      <div className="space-y-3">
        <FormField label="中文名称">
          <input
            className="input w-full"
            value={nameZh}
            onChange={(e) => setNameZh(e.target.value)}
          />
        </FormField>

        <FormField label="描述（可选）">
          <textarea
            className="h-20 w-full rounded-lg border border-ink-200 p-3 text-sm focus:border-primary focus:outline-none"
            placeholder="角色职责说明…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      </div>

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className="btn-ghost flex-1">
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!nameZh.trim() || busy}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  );
}

// ── 确认弹层 ──────────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger = false,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-5 text-sm text-ink-600">{message}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
            danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-primary hover:bg-primary/90'
          }`}
        >
          {loading ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ── 通用弹层壳 ────────────────────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-300 transition-colors hover:text-ink-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── 表单字段 ──────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-500">{label}</label>
      {children}
    </div>
  );
}
