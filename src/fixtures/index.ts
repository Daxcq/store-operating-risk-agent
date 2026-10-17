/**
 * 四种测试场景 (任务B 拥有)
 *
 * 关键设计：这四个 fixture 不是四份数据，而是同一份 data/store_operations_daily.csv 上的
 * 四个审计窗口 + 不同的可比组条件。好处是 D 的测试可以横向对照，且不会出现
 * "数据版本不一致导致结论不同" 的扯皮。
 *
 * 每个 fixture 都写清楚期望结果。D 直接拿 expected 做断言，
 * 不需要自己重新推一遍口径 —— 口径只有一份，就在 configs/ 里。
 *
 * 【可比门店数为什么逐指标写】
 * 门店数 21 家（S001~S021），C1（原朝阳区，参照集）标准档 5 家：S001(主体) + S002/S003/S004/S021。
 * S004 的 refund_amount 自 2026-10-06 起断报，所以：
 *   销售变化率口径可比 4 家、退款率口径可比 3 家、客单价口径可比 4 家。
 * 如果哪天有人把可比性改回「整店一刀切」，S004 会被整体剔除，
 * 销售口径掉到 3 家（还达标）、退款口径掉到 2 家（不达标），
 * S001 会从 possible 降级成 insufficient —— 主线演示当场失败。
 * 所以 expected.metric_peers 是这套 fixture 的回归防线，不是装饰。
 */

import type { Window, RuleVerdict } from "../../contracts/b/index";

export interface Fixture {
  id: string;
  name: string;
  /** 演示脚本里的一句话说明，可直接念 */
  demo_line: string;
  /** 审计窗口 */
  window: Window;
  /** 审计主体 */
  subject: { store_id: string; region: string; grade: string };
  /** 数据版本，用于报告里标注 */
  data_version: string;
  /** 期望结论 */
  expected: {
    verdict: RuleVerdict;
    hit_ids: string[];
    hit_count: number;
    risk_level: "normal" | "watch" | "high" | "unknown";
    /** 门禁指标（销售变化率）口径下的可比是否达标 */
    peer_sufficient: boolean;
    /**
     * 逐指标可比门店数。可比性是逐指标的，不是逐门店的：
     * 一家店可能销售数据完整、退款字段却断报（本 Demo 的 S004 就是这样），
     * 它对销售变化率依然可比，只是不能参与退款率对比。
     * D 应当断言这张表，而不只是断言一个笼统的 peer_sufficient。
     */
    metric_peers: { metric: string; usable: number; sufficient: boolean; dropped: string[] }[];
    /** 必须命中的关键数值，D 逐项断言 */
    assertions: { what: string; value: string }[];
  };
  /** 这个 fixture 要证明什么 */
  proves: string;
}

// 审计窗口统一用最近 7 个完整业务日，基准为前 7 日
// 数据范围 2026-09-01 ~ 2026-10-12
const CURRENT: Window = { from: "2026-10-06", to: "2026-10-12" };
const BASELINE: Window = { from: "2026-09-29", to: "2026-10-05" };

export const FIXTURES: Fixture[] = [
  {
    id: "normal",
    name: "正常门店",
    demo_line: "S006 各项指标与同区域中位数持平，四值判定为 none。",
    window: CURRENT,
    subject: { store_id: "S006", region: "C2", grade: "standard" },
    data_version: "demo_v1",
    expected: {
      verdict: "none",
      hit_ids: [],
      hit_count: 0,
      risk_level: "normal",
      peer_sufficient: true,
      metric_peers: [
        { metric: "sales_change_pct", usable: 3, sufficient: true, dropped: [] },
        { metric: "refund_rate", usable: 3, sufficient: true, dropped: [] },
        { metric: "aov_change_pct", usable: 3, sufficient: true, dropped: [] },
      ],
      assertions: [
        { what: "销售变化率", value: "波动在 ±5% 以内，未触及 -20% 阈值" },
        { what: "退款率", value: "低于 5% 阈值" },
        { what: "客单价变化率", value: "未触及 -10% 阈值" },
      ],
    },
    proves: "规则不会误报。这是假阳性防线，必须最先跑通。",
  },

  {
    id: "insufficient",
    name: "只命中 1 条 -> 证据不足",
    demo_line: "S005 只有退款率异常，命中 1 条规则，系统明确回答证据不足，而不是说它正常。",
    window: CURRENT,
    subject: { store_id: "S005", region: "C2", grade: "standard" },
    data_version: "demo_v1",
    expected: {
      verdict: "insufficient",
      hit_ids: ["refund_high"],
      hit_count: 1,
      risk_level: "watch",
      peer_sufficient: true,
      metric_peers: [
        { metric: "sales_change_pct", usable: 3, sufficient: true, dropped: [] },
        { metric: "refund_rate", usable: 3, sufficient: true, dropped: [] },
        { metric: "aov_change_pct", usable: 3, sufficient: true, dropped: [] },
      ],
      assertions: [
        { what: "退款率", value: "略高于 5% 阈值" },
        { what: "销售变化率", value: "未触及阈值" },
        { what: "客单价变化率", value: "未触及阈值" },
      ],
    },
    proves: "不把「不够判断」说成「没问题」。这是整个项目最容易被做错的诚实性要求。",
  },

  {
    id: "possible",
    name: "命中 3 条 -> 疑似异常（主线演示）",
    demo_line: "S001 销售下滑、退款率升高、客单价下滑三条同时命中，判定为疑似异常，生成行动卡。",
    window: CURRENT,
    subject: { store_id: "S001", region: "C1", grade: "standard" },
    data_version: "demo_v1",
    expected: {
      verdict: "possible",
      hit_ids: ["sales_drop", "refund_high", "aov_drop"],
      hit_count: 3,
      risk_level: "high",
      peer_sufficient: true,
      metric_peers: [
        { metric: "sales_change_pct", usable: 4, sufficient: true, dropped: [] },
        // S004 的退款字段自 10-06 起断报，退款项下只剩 3 家 —— 刚好达标。
        // 这一项必须显式断言：如果实现退化成「整店剔除」，这里会变成 3 家销售可比
        // 甚至更少，S001 会被降级成 insufficient，主线演示就崩了。
        { metric: "refund_rate", usable: 3, sufficient: true, dropped: ["S004"] },
        { metric: "aov_change_pct", usable: 4, sufficient: true, dropped: [] },
      ],
      assertions: [
        { what: "销售变化率", value: "低于 -20% 阈值" },
        { what: "退款率", value: "高于 5% 阈值" },
        { what: "客单价变化率", value: "低于 -10% 阈值" },
        { what: "销售口径可比门店数", value: "S002/S003/S004/S021 共 4 家，满足 min_peers=3" },
        { what: "退款口径可比门店数", value: "S002/S003/S021 共 3 家，满足 min_peers=3" },
        { what: "被剔除门店", value: "仅 C3（原西城区）4 家 compact 因业态档口不同被剔除" },
      ],
    },
    proves: "核心链路完整走通，且每个数字都能回到 evidence_id。",
  },

  {
    id: "unavailable",
    name: "数据缺失 -> 无法判断",
    demo_line: "S004 的退款字段自 10-06 起未上报，系统拒绝计算退款率，直接返回无法判断。",
    window: CURRENT,
    subject: { store_id: "S004", region: "C1", grade: "standard" },
    data_version: "demo_v1",
    expected: {
      verdict: "unavailable",
      hit_ids: [],
      hit_count: 0,
      risk_level: "unknown",
      peer_sufficient: true,
      metric_peers: [
        // 注意这里说的是 S004 作为**主体**去比：它自己的退款率算不出来，
        // 但销售口径的可比池依然是完整的 4 家。
        // 「本店某指标缺失」和「可比门店某指标缺失」是两回事，不要混为一谈。
        { metric: "sales_change_pct", usable: 4, sufficient: true, dropped: [] },
        { metric: "refund_rate", usable: 4, sufficient: true, dropped: [] },
        { metric: "aov_change_pct", usable: 4, sufficient: true, dropped: [] },
      ],
      assertions: [
        { what: "退款率", value: "null，status=unavailable，不得返回 0" },
        { what: "空值率", value: "关键字段空值率超过 20% 门槛" },
        { what: "结论", value: "报告必须写明无法判断及原因，不得给出建议动作" },
        { what: "可比性", value: "S004 自己的退款率缺失不影响它作为其他门店的可比对象" },
      ],
    },
    proves: "数据缺失时不产生确定性结论。这是报告可信度的底线。",
  },
];

/** 按 id 取 fixture */
export function getFixture(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}

/** 演示脚本的推荐顺序：先证伪，再证真，最后证边界 */
export const DEMO_ORDER = ["normal", "insufficient", "possible", "unavailable"];

export { CURRENT as FIXTURE_CURRENT_WINDOW, BASELINE as FIXTURE_BASELINE_WINDOW };
