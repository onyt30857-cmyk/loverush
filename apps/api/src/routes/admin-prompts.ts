/**
 * 管理后台 · Prompt Registry CRUD
 *
 * GET  /admin/prompts                列表(所有 key 的 active 版本)
 * GET  /admin/prompts/:key/versions  某 key 版本历史(新→旧)
 * POST /admin/prompts/:key           存新草稿版本(A 风控层只读拒绝)
 * POST /admin/prompts/:key/publish   发布/回滚某版本为 active
 *
 * 分层:A 风控层 prompt 后台只读(改走代码 review);B 调优层可改。所有写操作进 admin_audit_log。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';
import {
  listActiveTemplates,
  listVersions,
  saveDraft,
  publishVersion,
} from '../services/prompt-registry';

export const adminPromptsRoutes = new Hono();
adminPromptsRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

/** 列表 · 所有 key 的当前 active */
adminPromptsRoutes.get('/', async (c) => {
  const list = await listActiveTemplates({ db: getDb() });
  return c.json({ data: list });
});

/** 某 key 全版本历史 */
adminPromptsRoutes.get('/:key/versions', async (c) => {
  const list = await listVersions({ db: getDb() }, c.req.param('key'));
  return c.json({ data: list });
});

const SaveBody = z.object({
  content: z.string().min(1).max(20000),
  label: z.string().max(120).optional(),
  changeNote: z.string().max(500).optional(),
});

/** 存新草稿版本 · A 风控层只读拒绝 */
adminPromptsRoutes.post('/:key', zValidator('json', SaveBody), async (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  const db = getDb();

  const versions = await listVersions({ db }, key);
  if (versions[0]?.layer === 'A') {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      'A 风控层 prompt 后台只读 · 改动走代码 review',
    );
  }

  const draft = await saveDraft(
    { db },
    {
      key,
      content: body.content,
      label: body.label,
      changeNote: body.changeNote ?? null,
      createdBy: c.get('userId'),
    },
  );

  await recordAudit({ db }, c, {
    action: 'prompt.save_draft',
    targetType: 'prompt_template',
    targetId: key,
    after: { version: draft.version, changeNote: body.changeNote ?? null },
    reason: body.changeNote ?? '存草稿',
  });

  return c.json({ data: draft });
});

const PublishBody = z.object({ version: z.number().int().min(1) });

/** 发布/回滚某版本为 active */
adminPromptsRoutes.post('/:key/publish', zValidator('json', PublishBody), async (c) => {
  const key = c.req.param('key');
  const { version } = c.req.valid('json');
  const db = getDb();

  const versions = await listVersions({ db }, key);
  const target = versions.find((v) => v.version === version);
  if (!target) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, '该版本不存在');
  }
  if (target.layer === 'A') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'A 风控层 prompt 后台只读');
  }

  await publishVersion({ db }, { key, version });

  await recordAudit({ db }, c, {
    action: 'prompt.publish',
    targetType: 'prompt_template',
    targetId: key,
    after: { version },
    reason: `发布 v${version}`,
  });

  return c.json({ data: { key, version, status: 'active' } });
});
