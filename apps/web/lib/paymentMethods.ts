// M16 · 代理收款方式 · 字段模板（前端动态渲染驱动）
//
// 加新收款类型 = 在这里加一项 + 跑 enum 迁移（packages/db）。代理端按 fields 渲染表单，
// 客户端按 fields 展示给客户。isQr 的字段渲染成图片（收款码）。
// 与后端 routes/agents.ts 的 method_type zod enum、enums.ts agentPaymentMethodTypeEnum 保持一致。

export interface PMField {
  key: string;
  label: string;
  optional?: boolean;
  isQr?: boolean; // true → 值是图片链接，展示为收款码
  placeholder?: string;
}

export interface PMType {
  key: string;
  label: string;
  hint?: string;
  fields: PMField[];
}

export const PAYMENT_METHOD_TYPES: PMType[] = [
  {
    key: 'bank',
    label: '银行转账',
    fields: [
      { key: 'holder', label: '收款人姓名' },
      { key: 'account', label: '银行账号' },
      { key: 'bankName', label: '银行名称', optional: true },
      { key: 'swift', label: 'SWIFT/BIC（跨境可选）', optional: true },
    ],
  },
  {
    key: 'usdt_trc20',
    label: 'USDT-TRC20',
    hint: '仅支持 TRC20 链，地址务必核对',
    fields: [{ key: 'address', label: 'TRC20 钱包地址', placeholder: 'T 开头的地址' }],
  },
  {
    key: 'promptpay',
    label: '泰国 PromptPay',
    fields: [
      { key: 'account', label: 'PromptPay 手机号 / ID' },
      { key: 'qrUrl', label: '收款二维码链接', optional: true, isQr: true },
    ],
  },
  {
    key: 'alipay',
    label: '支付宝',
    fields: [
      { key: 'account', label: '支付宝账号' },
      { key: 'qrUrl', label: '收款码链接', optional: true, isQr: true },
    ],
  },
  {
    key: 'wechat',
    label: '微信',
    fields: [
      { key: 'account', label: '微信号' },
      { key: 'qrUrl', label: '收款码链接', optional: true, isQr: true },
    ],
  },
  {
    key: 'other',
    label: '其它',
    hint: '如 Wise / 现金当面 / Momo 等，自填说明',
    fields: [
      { key: 'typeName', label: '方式名称（如 Wise / 现金）' },
      { key: 'account', label: '收款账号 / 说明' },
      { key: 'qrUrl', label: '二维码链接', optional: true, isQr: true },
    ],
  },
];

export const PM_TYPE_MAP: Record<string, PMType> = Object.fromEntries(
  PAYMENT_METHOD_TYPES.map((t) => [t.key, t]),
);

export const PM_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHOD_TYPES.map((t) => [t.key, t.label]),
);

/** 取某类型对外展示用的"主标识"字段值（列表里显一行用） */
export function pmPrimaryValue(methodType: string, fields: Record<string, string>): string {
  const t = PM_TYPE_MAP[methodType];
  if (!t) return Object.values(fields)[0] ?? '';
  const first = t.fields.find((f) => !f.isQr);
  return (first && fields[first.key]) || Object.values(fields)[0] || '';
}
