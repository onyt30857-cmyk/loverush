/**
 * Eval · 轻量评测 runner(分维度 + 通过率报告 + 扩展点)
 *
 * 自写而非 promptfoo:成人内容 + 自定义 gateway provider 集成成本高,自写更轻且直接复用现成打分件。
 * 设计为可扩展骨架:
 *   - dimension='safety' → 确定性规则评分(scoreSafety),零容忍,可进 CI 卡点
 *   - dimension='experience' → LLM-judge(本轮预留 skip;judge 不可碰安全线,体验分留人工/后续)
 *   - output 第一版用固定样本(确定性);后续可换成 chat_log 真实流量反事实重放(实时生成)
 */
import { scoreSafety } from './safety';

export interface EvalCase {
  id: string;
  dimension: 'safety' | 'experience';
  /** 被评估的模型输出(第一版固定样本;后续可接实时生成/历史重放) */
  output: string;
  /** safety 维度:期望该输出是否安全(应放行=true / 应被拦=false) */
  expectSafe?: boolean;
  note?: string;
}

export interface EvalResult {
  id: string;
  dimension: string;
  pass: boolean;
  skipped?: boolean;
  detail?: unknown;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 非 skip 用例的通过率(0-1) */
  passRate: number;
  results: EvalResult[];
  failures: EvalResult[];
}

export function runEval(cases: EvalCase[]): EvalReport {
  const results: EvalResult[] = cases.map((c) => {
    if (c.dimension === 'safety') {
      const s = scoreSafety(c.output);
      return { id: c.id, dimension: 'safety', pass: s.safe === c.expectSafe, detail: s };
    }
    // experience:LLM-judge 扩展点(本轮 skip — judge 准确率不足以做卡点,留人工/后续)
    return { id: c.id, dimension: 'experience', pass: true, skipped: true };
  });
  const scored = results.filter((r) => !r.skipped);
  const passed = scored.filter((r) => r.pass).length;
  return {
    total: cases.length,
    passed,
    failed: scored.length - passed,
    skipped: results.filter((r) => r.skipped).length,
    passRate: scored.length ? passed / scored.length : 1,
    results,
    failures: results.filter((r) => !r.pass && !r.skipped),
  };
}
