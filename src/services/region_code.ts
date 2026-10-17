/**
 * 区域编码映射 (任务B)
 *
 * 数据层内部一律用中文区域名（"朝阳区"），因为数据源 CSV 里就是这个，
 * 全量改名的收益抵不上风险。但共享契约 contracts/src/index.ts 的
 * RegionResult.regionId 是拼音 slug（"chaoyang"），前端路由和 URL query
 * 也按 slug 走。两套写法必须有一个唯一的转换点，
 * 否则迟早出现「chaoyang」和「朝阳区」两份区域列表对不上的问题。
 *
 * 这里是那个唯一的转换点。任何地方要转换区域标识，只能调这里。
 *
 * 输入同时接受 slug 和中文名：前端可能直接把手填的中文名传进来，
 * 与其让它变成 404，不如认下来。输出的 regionId 永远是 slug。
 */

/**
 * 中文区域名 -> slug。新增区域时只改这一处。
 *
 * 【两套数据集的区名分区，不要合并】
 *   主线（长春五区，src/main.jsx + supabase/init.sql + data_layer/fixtures.py）：
 *     朝阳区 -> chaoyang，南关区 -> nanguan，宽城区 -> kuancheng，
 *     二道区 -> erdao，绿园区 -> luyuan
 *   参照集（data/_generate.py 生成的 21 店数据集，原北京五区）：
 *     C1 -> c1，C2 -> c2，C3 -> c3，C4 -> c4，C5 -> c5
 *
 * 参照集原先直接叫朝阳区/海淀区/西城区/东城区/丰台区，与长春套的朝阳区同名。
 * 同一个「朝阳区」在两套数据里是不同城市的商圈，slug 会互相覆盖，
 * 表现为「按 regionId 查出来的门店集合时多时少」。已改成中性代号，两套互不相干。
 */
const SLUG_BY_NAME: Record<string, string> = {
  // 主线：长春
  朝阳区: "chaoyang",
  南关区: "nanguan",
  宽城区: "kuancheng",
  二道区: "erdao",
  绿园区: "luyuan",
  // 参照集：中性代号
  C1: "c1",
  C2: "c2",
  C3: "c3",
  C4: "c4",
  C5: "c5",
};

/** slug -> 中文区域名，由上面反向生成，避免两份表漂移 */
const NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_BY_NAME).map(([name, slug]) => [slug, name]),
);

/** 契约示例里用的是河北「南关」之类的行政区，我们数据里没有，仅供对照 */
export const KNOWN_SLUGS: string[] = Object.values(SLUG_BY_NAME).sort();

/** 中文名 -> slug。未登记的区域返回 null，由调用方决定是 400 还是兜底 */
export function toRegionId(name: string): string | null {
  return SLUG_BY_NAME[name] ?? null;
}

/**
 * 任意写法 -> 中文区域名。认不出来返回 null。
 *
 * 认不出来时返回 null 而不是原样返回：原样返回会让
 * 「regionId=chaoyangh」这种拼写错误一路穿透到过滤逻辑，
 * 最后表现为「朝阳区查询返回空」，看起来像数据缺失，
 * 实际是参数错误。这两种错在界面上必须是两种不同的提示。
 */
export function toRegionName(idOrName: string): string | null {
  const v = idOrName.trim();
  if (v === "") return null;
  if (SLUG_BY_NAME[v]) return v; // 已经是中文名
  return NAME_BY_SLUG[v] ?? null;
}
