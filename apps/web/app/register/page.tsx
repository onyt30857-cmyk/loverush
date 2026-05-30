/**
 * /register 兜底跳转 · 防外部老链接死链
 *
 * 历史:旧版有身份选择中转页 · commit c548abf 删了
 * 当前 splash 已改直跳 /register/customer · 但 /register 直链仍要 200
 * 默认导向客户注册(技师走 splash 入口主动选)
 */
import { redirect } from 'next/navigation';

export default function RegisterIndex(): never {
  redirect('/register/customer');
}
