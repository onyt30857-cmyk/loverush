/**
 * 用 v1/prototypes/images 真人原型图批量补全已有技师档案
 *
 * 用法:
 *   wrapper bash 先 source .env.production · 然后:
 *     tsx scripts/seed-prototype-images.ts --dry-run
 *     tsx scripts/seed-prototype-images.ts --execute
 *
 * 策略:
 *   - 拉 verification_status IN ('pending','passed') 的技师 · 按 created_at 排
 *   - 每技师分配 1 张头像 + N 张相册图(N 动态)
 *   - 已有 avatar_url 的跳过头像 · 已有非空 gallery_json 跳过相册
 *   - bio/nationality/service_city/tags 空时按 hash 选模板填
 *   - 图传到 R2 · 命名 avatar/seed-prototype/t-NN.png · 幂等(R2 同 key 覆盖,db 同 r2_key UNIQUE)
 *   - mediaAssets 直接写 auditStatus='approved'(运营内部素材免审)
 *   - 注意:liveness/verification 不动 · 真技师要自己提交
 *
 * 安全:
 *   - 仅扫 verification_status IN ('pending','passed') · 避免覆盖被驳回的技师
 *   - 已有 avatarUrl 不动 · 仅补全缺的
 *   - --dry-run 必跑一次 · 看清楚再 --execute
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, or } from 'drizzle-orm';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as schema from '../packages/db/src/schema';
const { therapists, users, mediaAssets } = schema;

// ──────────────── 配置 ────────────────

const IMAGES_DIR = path.resolve(__dirname, '../../v1/prototypes/images');
const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!DRY_RUN && !EXECUTE) {
  console.error('必须指定 --dry-run 或 --execute');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? 'https://media.loverush.com';

if (!DATABASE_URL) throw new Error('DATABASE_URL 未设置(bash wrapper 没 source .env.production?)');
if (EXECUTE && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME)) {
  throw new Error('R2_* 凭证不全 · execute 模式必须有 R2');
}

// ──────────────── 模板库(空字段补全用) ────────────────

const BIO_TEMPLATES = [
  '本人在曼谷工作多年的中医推拿,擅长肩颈腰背调理,手法柔和不暴力,客人多是老客户回头。喜欢安静的工作氛围,讨厌着急催的客人。',
  '马来吉隆坡 · 自己开工作室 · 主做泰式精油 + 肩颈,客人多预约2小时档。性格慢热,不主动聊天,但你聊我会陪你。',
  '90 后槟城妹,做这行 4 年,熟练 SPA 全身 + 泰式拉伸 + 头疗。喜欢音乐和猫,不喜欢吹牛的客人,真诚相待。',
  '越南胡志明市,会一些中文 · 主做精油 + 香薰 + 足底反射区。手温热,适合冬天来一次。介意香氛过敏请提前说。',
  '新加坡本地 · 半路出家从瑜伽老师转过来 · 手法偏拉伸和经络疏通,不是按摩棒那种,适合常坐办公室的客人。',
  '印尼雅加达,做日式指压6年,客人评价是"刚好的力度,睡过去那种"。技能比较单一但深 · 别问我会不会精油,我不会。',
  '泰国清迈古城区,纯泰式 + 草本热敷,客人多是来旅游的回头客。安静慢节奏,不喜欢边按边自拍发朋友圈的客人。',
  '马来槟城,中泰双语都行 · 主项是中式经络 + 拔罐 + 刮痧,辅助精油。客人来过基本不换人,我也认人。',
];

// 国籍 → 该国籍的服务城市候选(业务对齐 · 避免国籍越南但城市新加坡这种)
// 注意:实际有不少按摩师在异国服务 · 但 demo 数据保持国籍/城市一致更可信
const NATIONALITY_CITY_MAP: Record<string, string[]> = {
  '泰国': ['曼谷', '清迈', '普吉'],
  '马来西亚': ['吉隆坡', '槟城'],
  '越南': ['胡志明市', '河内'],
  '印尼': ['雅加达', '巴厘岛'],
  '新加坡': ['新加坡'],
  '中国': ['曼谷', '吉隆坡', '槟城', '胡志明市'], // 中国国籍在异国工作
};
const NATIONALITIES = Object.keys(NATIONALITY_CITY_MAP);
const NATIONALITY_COUNTRY: Record<string, string> = {
  '泰国': '泰国', '马来西亚': '马来西亚', '越南': '越南',
  '印尼': '印尼', '新加坡': '新加坡', '中国': '泰国', // 中国国籍默认服务国按城市定
};

const TAG_POOLS = [
  ['泰式', '精油', '肩颈'],
  ['中式经络', '拔罐', '刮痧'],
  ['日式指压', '深层放松'],
  ['SPA', '香薰', '足底'],
  ['泰式拉伸', '头疗', '舒压'],
  ['精油', '热敷', '草本'],
  ['推拿', '中医调理', '肩颈腰背'],
];

const LANGUAGES_POOL = [
  ['中文', '英文'],
  ['中文', '泰语'],
  ['中文', '英文', '马来语'],
  ['中文', '越南语'],
  ['中文', '英文', '印尼语'],
];

function hashPick<T>(seed: string, pool: T[]): T {
  // 把 md5 前 4 字节当 uint32 · 大幅降低冲突率(相比单字节 1/256 vs 1/16M)
  const h = crypto.createHash('md5').update(seed).digest();
  const n = (h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!;
  return pool[Math.abs(n) % pool.length]!;
}

/** 按 index 轮询分配 · 完全避免冲突 · 用于 bio 这种 5 选 8 时优先用 */
function pickByIndex<T>(idx: number, pool: T[]): T {
  return pool[idx % pool.length]!;
}

// ──────────────── 主流程 ────────────────

interface PrototypeImage {
  name: string; // t-1.png
  fullPath: string;
  sizeBytes: number;
  buffer?: Buffer;
}

async function loadImages(): Promise<PrototypeImage[]> {
  const files = fs.readdirSync(IMAGES_DIR)
    .filter((f) => /^t-\d+\.png$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0], 10);
      const nb = parseInt(b.match(/\d+/)![0], 10);
      return na - nb;
    });
  return files.map((name) => {
    const fullPath = path.join(IMAGES_DIR, name);
    return {
      name,
      fullPath,
      sizeBytes: fs.statSync(fullPath).size,
    };
  });
}

function makeR2Key(purpose: 'avatar' | 'gallery', imgName: string): string {
  // seed-prototype 前缀让 admin 一眼看出是运营素材 · 不与真技师上传混淆
  return `${purpose}/seed-prototype/${imgName}`;
}

function makePublicUrl(r2Key: string): string {
  return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`;
}

async function uploadToR2(s3: S3Client, img: PrototypeImage, r2Key: string): Promise<void> {
  // 幂等:同 key 已存在 → 跳过(R2 PUT 是 overwrite,但避免无谓上传)
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME!, Key: r2Key }));
    console.log(`    ↪ R2 已有 ${r2Key} · 跳过上传`);
    return;
  } catch {
    // 不存在 · 继续上传
  }
  const buffer = img.buffer ?? fs.readFileSync(img.fullPath);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME!,
    Key: r2Key,
    Body: buffer,
    ContentType: 'image/png',
    ContentLength: buffer.length,
  }));
  console.log(`    ↑ 上传 ${r2Key} (${(buffer.length / 1024).toFixed(0)}KB)`);
}

async function main() {
  console.log(`\n=== Seed Prototype Images · ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'} ===\n`);

  // 1. 加载图
  const images = await loadImages();
  console.log(`📷 找到 ${images.length} 张原型图 (t-1.png ~ t-${images.length}.png)\n`);

  // 2. 连 db(postgres-js · 跟 packages/db createDb 一致)
  const isTxnPooler = /\bpooler\b|:6543\b/i.test(DATABASE_URL);
  const sql = postgres(DATABASE_URL, { max: 5, prepare: !isTxnPooler });
  const db = drizzle(sql, { schema });

  try {
    // 3. 拉技师 + 关联 users.displayName
    const rows = await db
      .select({
        therapistId: therapists.id,
        userId: therapists.userId,
        displayName: users.displayName,
        verificationStatus: therapists.verificationStatus,
        avatarUrl: therapists.avatarUrl,
        bio: therapists.bio,
        nationality: therapists.nationality,
        serviceCountry: therapists.serviceCountry,
        serviceCity: therapists.serviceCity,
        tags: therapists.tags,
        languages: therapists.languages,
        galleryJson: therapists.galleryJson,
        createdAt: therapists.createdAt,
      })
      .from(therapists)
      .innerJoin(users, eq(therapists.userId, users.id))
      .where(or(
        eq(therapists.verificationStatus, 'pending'),
        eq(therapists.verificationStatus, 'passed'),
      ));

    // 按 createdAt 排序(纯前端 sort · drizzle orderBy 可选)
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    console.log(`👥 找到 ${rows.length} 个技师 (verification_status IN pending/passed)\n`);
    if (rows.length === 0) {
      console.log('⚠️  数据库无符合条件的技师 · 退出');
      return;
    }

    // 4. 分配策略:1 头像 + N 相册
    // N = min(9, floor((images.length - avatarsNeeded) / rowsNeedingGallery))
    // 上限 9 张(再多客户也滑不完)· 下限 3 张(让付费图机制有得展示)
    const avatarsNeeded = rows.filter((r) => !r.avatarUrl).length;
    const rowsNeedingGallery = rows.filter((r) => {
      const g = (r.galleryJson as unknown[] | null) ?? [];
      return g.length === 0;
    }).length;
    const galleryCandidates = images.length - avatarsNeeded;
    const galleryPerTherapist = Math.max(3, Math.min(9, Math.floor(galleryCandidates / Math.max(1, rowsNeedingGallery))));

    console.log(`📊 分配计划:`);
    console.log(`    · ${avatarsNeeded}/${rows.length} 个技师缺头像 → 各分 1 张`);
    console.log(`    · 每技师 ${galleryPerTherapist} 张相册图(含 1 张付费图)`);
    console.log(`    · 总计将用 ${avatarsNeeded + rows.length * galleryPerTherapist} 张图 / 共 ${images.length} 张可用\n`);

    if (avatarsNeeded + rows.length * galleryPerTherapist > images.length) {
      console.log('⚠️  图不够 · 部分相册会从头复用图(轮流)\n');
    }

    // 5. 初始化 R2 client(仅 execute 用)
    let s3: S3Client | null = null;
    if (EXECUTE) {
      s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY! },
      });
    }

    // 6. 遍历技师 · 分配 + (条件上传) + 写 db
    let imgPointer = 0;
    function nextImg(): PrototypeImage {
      const img = images[imgPointer % images.length]!;
      imgPointer++;
      return img;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      console.log(`\n[${i + 1}/${rows.length}] ${r.displayName ?? '(无昵称)'} · ${r.userId.slice(0, 8)}`);
      console.log(`    现状: avatar=${r.avatarUrl ? '有' : '无'} · gallery=${(r.galleryJson as unknown[] | null)?.length ?? 0} · bio=${r.bio ? `${r.bio.slice(0, 12)}...` : '无'} · 国籍=${r.nationality ?? '无'} · 城市=${r.serviceCity ?? '无'}`);

      const updates: Record<string, unknown> = {};
      const mediaInserts: Array<{ purpose: 'avatar' | 'gallery'; r2Key: string; publicUrl: string; img: PrototypeImage }> = [];

      // 头像
      if (!r.avatarUrl) {
        const img = nextImg();
        const r2Key = makeR2Key('avatar', img.name);
        const publicUrl = makePublicUrl(r2Key);
        mediaInserts.push({ purpose: 'avatar', r2Key, publicUrl, img });
        updates.avatarUrl = publicUrl;
        console.log(`    + 头像 ← ${img.name}`);
      }

      // 相册
      const curGallery = (r.galleryJson as Array<{ url: string; isPaid: boolean }> | null) ?? [];
      if (curGallery.length === 0) {
        const galleryItems: Array<{ url: string; isPaid: boolean; pricePoints?: number }> = [];
        for (let g = 0; g < galleryPerTherapist; g++) {
          const img = nextImg();
          const r2Key = makeR2Key('gallery', img.name);
          const publicUrl = makePublicUrl(r2Key);
          mediaInserts.push({ purpose: 'gallery', r2Key, publicUrl, img });
          // 第 1 张标付费图(让客户感受到付费墙)
          const isPaid = g === 0;
          galleryItems.push({ url: publicUrl, isPaid, ...(isPaid ? { pricePoints: 50 } : {}) });
          console.log(`    + 相册${g + 1} ← ${img.name}${isPaid ? ' (付费)' : ''}`);
        }
        updates.galleryJson = galleryItems;
      }

      // bio 模板 · round-robin 按 i 分配 · 避免 hash 冲突
      if (!r.bio || r.bio.length < 20) {
        updates.bio = pickByIndex(i, BIO_TEMPLATES);
        console.log(`    + bio ← ${(updates.bio as string).slice(0, 16)}...`);
      }

      // 国籍 · 决定一次 · 后面的城市/国家从该国籍候选选
      let nationality: string | undefined;
      if (!r.nationality) {
        nationality = hashPick(r.userId + 'n', NATIONALITIES);
        updates.nationality = nationality;
        console.log(`    + 国籍 ← ${nationality}`);
      }

      // 城市 · 必须跟国籍配套
      if (!r.serviceCity) {
        const useNationality = nationality ?? r.nationality ?? hashPick(r.userId, NATIONALITIES);
        const cities = NATIONALITY_CITY_MAP[useNationality] ?? NATIONALITY_CITY_MAP['泰国']!;
        const city = hashPick(r.userId + 'c', cities);
        const country = NATIONALITY_COUNTRY[useNationality] ?? useNationality;
        updates.serviceCountry = country;
        updates.serviceCity = city;
        console.log(`    + 城市 ← ${country}/${city}`);
      }

      // 标签
      if (!r.tags || r.tags.length === 0) {
        updates.tags = hashPick(r.userId + 't', TAG_POOLS);
        console.log(`    + 标签 ← ${(updates.tags as string[]).join('/')}`);
      }

      // 语言
      if (!r.languages || r.languages.length === 0) {
        updates.languages = hashPick(r.userId + 'l', LANGUAGES_POOL);
        console.log(`    + 语言 ← ${(updates.languages as string[]).join('/')}`);
      }

      // 执行
      if (EXECUTE && s3) {
        // 6.1 上传图 R2
        for (const m of mediaInserts) {
          await uploadToR2(s3, m.img, m.r2Key);
        }
        // 6.2 写 mediaAssets(同 r2_key UNIQUE · 用 onConflictDoNothing)
        if (mediaInserts.length > 0) {
          await db.insert(mediaAssets).values(mediaInserts.map((m) => ({
            ownerUserId: r.userId,
            type: 'photo' as const,
            r2Key: m.r2Key,
            publicUrl: m.publicUrl,
            mimeType: 'image/png',
            sizeBytes: m.img.sizeBytes,
            purpose: m.purpose,
            visibility: 'public' as const,
            auditStatus: 'approved' as const, // 运营素材免审
            auditedAt: new Date(),
            isEncrypted: 0,
            watermarkApplied: 0,
          }))).onConflictDoNothing();
        }
        // 6.3 更新 therapists
        if (Object.keys(updates).length > 0) {
          await db.update(therapists).set(updates).where(eq(therapists.id, r.therapistId));
        }
        console.log(`    ✓ 已写入 db`);
      } else {
        console.log(`    [dry-run · 不写]`);
      }
    }

    console.log(`\n=== ${DRY_RUN ? '✓ DRY RUN 完成 · 上方为计划' : '✅ EXECUTE 完成'} ===\n`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});
