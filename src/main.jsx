import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  DollarSign,
  Gauge,
  Layers,
  Layers3,
  Lock,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import changchunGeo from './data/changchun_geo.json'
import { AgentWorkbench } from './AgentWorkbench.jsx'
import { AgentLoopPanel } from './AgentLoopPanel.jsx'
import { AgentStructuredOutput, AgentLiveThinkingState } from './AgentStructuredOutput.jsx'

const DISTRICT_PEER_SERIES = {
  chaoyang: [346246, 342926, 344797, 345014, 342520, 347223],
  nanguan: [338042, 343406, 336711, 345384, 342701, 339362],
  kuancheng: [217036, 217023, 218160, 219660, 218792, 217012],
  erdao: [355468, 356639, 352242, 356086, 356269, 357162],
  luyuan: [274808, 272688, 270639, 271125, 271748, 272413],
}

const NAME_TO_REGION_ID = {
  朝阳区: 'chaoyang',
  南关区: 'nanguan',
  宽城区: 'kuancheng',
  二道区: 'erdao',
  绿园区: 'luyuan',
}

const DISTRICT_META = {
  chaoyang: {
    name: '朝阳区',
    regionId: 'chaoyang',
    color: '#c74743',
    fillColor: '#e05a54',
    center: [43.862, 125.302],
    tag: '存量抢修优先 · 商圈高密',
    shortDesc: '契约评分 86.5 · 实测月租+人力 ¥21.4万 · 含 A店/S001 异常与 S004 缺失保护',
  },
  nanguan: {
    name: '南关区',
    regionId: 'nanguan',
    color: '#bd7b13',
    fillColor: '#d99326',
    center: [43.868, 125.342],
    tag: '基线补齐与调优 · 办公核心',
    shortDesc: '契约评分 71.0 (回本周期 null 保护) · 含 B店/S005 单指标退款波动',
  },
  kuancheng: {
    name: '宽城区',
    regionId: 'kuancheng',
    color: '#2563eb',
    fillColor: '#3b82f6',
    center: [43.922, 125.335],
    tag: '紧凑档扩店 #2 · 5.3月回本',
    shortDesc: '全区 CSV 门店均为 compact 紧凑档 · 月租+人力仅 ¥11.5万 · 枢纽客流稳',
  },
  erdao: {
    name: '二道区',
    regionId: 'erdao',
    color: '#1b6ca8',
    fillColor: '#2980b9',
    center: [43.872, 125.386],
    tag: '标准档扩店 #1 · CSV得分第一',
    shortDesc: 'CSV 四维综合分 45.54 全城第一 · 单店月净现金流 ¥25.0万 · 5.7月回本',
  },
  luyuan: {
    name: '绿园区',
    regionId: 'luyuan',
    color: '#258b68',
    fillColor: '#2ea87e',
    center: [43.888, 125.248],
    tag: '蓝海增量首选 · 5.2月最快回本',
    shortDesc: '半径内仅 3 家同档店 · 标准店月总成本 ¥14.2万全城最低 · 5.2个月极速回本',
  },
}

const CSV_STORE_SEED = [
  { id: 'S001', name: '朝阳红旗街店 (CSV实测)', district: '朝阳区', regionId: 'chaoyang', tier: 'standard', address: '红旗街万达核心点 · 3规则全命中', lat: 43.864, lng: 125.296, risk: 'possible', verdict: 'possible', sales: 235542, baselineSales: 359192, salesGap: -34.4, orders: 2819, ordersGap: -3.5, aov: 83.6, aovGap: -32.0, ordC: -10, aovC: -90, refundRate: 5.91, refundOrders: 168, peerRefund: 2.19, dev: 46, onlineDev: 31, invDiff: -1209, weeks: [362284, 366244, 369571, 367089, 359192, 235542], action: '立即核查 S001 异常退款批次（5.91%）与 15 台离线智能柜，排查高客单商品下架原因' },
  { id: 'S002', name: '朝阳桂林路店', district: '朝阳区', regionId: 'chaoyang', tier: 'standard', address: '桂林路同志街商圈 · 标准云值守', lat: 43.873, lng: 125.314, risk: 'normal', verdict: 'none', sales: 340463, baselineSales: 338742, salesGap: 0.5, orders: 2704, ordersGap: -1.5, aov: 125.9, aovGap: 2.0, ordC: -42, aovC: 58, refundRate: 2.18, refundOrders: 60, peerRefund: 2.19, dev: 42, onlineDev: 37, invDiff: -1259, weeks: [340032, 333202, 338345, 339274, 338742, 340463], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S003', name: '朝阳前进大街店', district: '朝阳区', regionId: 'chaoyang', tier: 'standard', address: '前进大街吉大南校旁 · 高校微超', lat: 43.836, lng: 125.288, risk: 'normal', verdict: 'none', sales: 358867, baselineSales: 355028, salesGap: 1.1, orders: 2904, ordersGap: 1.9, aov: 123.6, aovGap: -0.8, ordC: 70, aovC: -30, refundRate: 2.21, refundOrders: 64, peerRefund: 2.19, dev: 45, onlineDev: 39, invDiff: -1328, weeks: [354910, 351251, 361225, 353843, 355028, 358867], action: '保持常规监测（高校夜间云值守标杆）' },
  { id: 'S004', name: '朝阳欧亚商都店 (缺失数据)', district: '朝阳区', regionId: 'chaoyang', tier: 'standard', address: '工农大路欧亚商圈 · 演示数据缺失保护', lat: 43.858, lng: 125.305, risk: 'unavailable', verdict: 'unavailable', sales: null, baselineSales: 314053, salesGap: 0, orders: null, ordersGap: 0, aov: null, aovGap: 0, ordC: 0, aovC: 0, refundRate: null, refundOrders: null, peerRefund: 2.19, dev: 40, onlineDev: 35, invDiff: null, weeks: [315692, 314706, 311178, 315628, 314053, null], action: '数据缺失不可判断（严禁生成确定性建议）', verdictReason: 'S004 近 7 天（10.06—10.12）缺失退款金额与退款笔数核心字段，触发安全铁律：verdict=unavailable，阻断一切归因与派单。' },
  { id: 'S021', name: '朝阳南湖大路店', district: '朝阳区', regionId: 'chaoyang', tier: 'standard', address: '南湖公园北门商圈 · 标准云值守', lat: 43.848, lng: 125.312, risk: 'normal', verdict: 'none', sales: 353982, baselineSales: 346297, salesGap: 2.2, orders: 2831, ordersGap: 1.0, aov: 125.0, aovGap: 1.2, ordC: 46, aovC: 54, refundRate: 2.19, refundOrders: 62, peerRefund: 2.19, dev: 44, onlineDev: 39, invDiff: -1180, weeks: [352460, 347430, 349617, 350754, 346297, 353982], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S005', name: '南关重庆路店 (单指标波动)', district: '南关区', regionId: 'nanguan', tier: 'standard', address: '重庆路步行街 · 仅退款率偏高', lat: 43.884, lng: 125.335, risk: 'watch', verdict: 'insufficient', sales: 332282, baselineSales: 331564, salesGap: 0.2, orders: 2718, ordersGap: 0.1, aov: 122.3, aovGap: 0.1, ordC: 60, aovC: 40, refundRate: 6.3, refundOrders: 171, peerRefund: 2.18, dev: 42, onlineDev: 37, invDiff: -1164, weeks: [328573, 335274, 327573, 336691, 331564, 332282], action: '仅命中退款率偏高（6.3%）单指标，销售额与客单价稳定，证据不足不触发 P1 升级，建议店长自查临期饮品批次' },
  { id: 'S006', name: '南关活力城店 (CSV正常标杆)', district: '南关区', regionId: 'nanguan', tier: 'standard', address: '活力城B1层 · 0规则命中标杆', lat: 43.876, lng: 125.344, risk: 'normal', verdict: 'none', sales: 354024, baselineSales: 364124, salesGap: -2.8, orders: 2838, ordersGap: 1.6, aov: 124.7, aovGap: -4.3, ordC: 35, aovC: -65, refundRate: 2.18, refundOrders: 63, peerRefund: 2.18, dev: 44, onlineDev: 38, invDiff: -1062, weeks: [354418, 354498, 357373, 354389, 364124, 354024], action: '保持常规监测（南关区核心标杆样本）' },
  { id: 'S007', name: '南关净月生态大街店', district: '南关区', regionId: 'nanguan', tier: 'standard', address: '生态大街环球贸易中心 · 写字楼店', lat: 43.822, lng: 125.366, risk: 'normal', verdict: 'none', sales: 322891, baselineSales: 321496, salesGap: 0.4, orders: 2571, ordersGap: -1.0, aov: 125.6, aovGap: 1.4, ordC: -40, aovC: 60, refundRate: 2.15, refundOrders: 55, peerRefund: 2.18, dev: 40, onlineDev: 35, invDiff: -1195, weeks: [328381, 326515, 316963, 323349, 321496, 322891], action: '保持常规监测（写字楼白领客群稳定）' },
  { id: 'S008', name: '南关人民大街店', district: '南关区', regionId: 'nanguan', tier: 'standard', address: '人民大街解放大路地铁口 · 枢纽标准店', lat: 43.862, lng: 125.338, risk: 'normal', verdict: 'none', sales: 346441, baselineSales: 353838, salesGap: -2.1, orders: 2822, ordersGap: 1.6, aov: 122.8, aovGap: -3.6, ordC: 38, aovC: -62, refundRate: 2.16, refundOrders: 61, peerRefund: 2.18, dev: 43, onlineDev: 38, invDiff: -1187, weeks: [347710, 351538, 345849, 354077, 353838, 346441], action: '保持常规监测（地铁枢纽客流正常）' },
  { id: 'S009', name: '宽城长春站北口店', district: '宽城区', regionId: 'kuancheng', tier: 'compact', address: '长春站北广场换乘中心 · 紧凑型云值守', lat: 43.918, lng: 125.324, risk: 'normal', verdict: 'none', sales: 218458, baselineSales: 219632, salesGap: -0.5, orders: 1811, ordersGap: -1.3, aov: 120.6, aovGap: 0.7, ordC: -62, aovC: 38, refundRate: 2.21, refundOrders: 40, peerRefund: 2.2, dev: 28, onlineDev: 25, invDiff: -765, weeks: [220538, 219510, 218039, 220964, 219632, 218458], action: '保持常规监测（compact 紧凑档标杆）' },
  { id: 'S010', name: '宽城黑水路商贸店', district: '宽城区', regionId: 'kuancheng', tier: 'compact', address: '黑水路商贸区 · 紧凑型微超', lat: 43.904, lng: 125.342, risk: 'normal', verdict: 'none', sales: 206940, baselineSales: 208456, salesGap: -0.7, orders: 1739, ordersGap: -0.6, aov: 119.0, aovGap: -0.1, ordC: -82, aovC: -18, refundRate: 2.24, refundOrders: 39, peerRefund: 2.2, dev: 27, onlineDev: 24, invDiff: -728, weeks: [209977, 210393, 207491, 209779, 208456, 206940], action: '保持常规监测（批发商圈日间客流稳）' },
  { id: 'S011', name: '宽城凯旋路社区店', district: '宽城区', regionId: 'kuancheng', tier: 'compact', address: '凯旋路北环城路地铁旁 · 紧凑型标杆', lat: 43.938, lng: 125.318, risk: 'normal', verdict: 'none', sales: 229246, baselineSales: 227823, salesGap: 0.6, orders: 1888, ordersGap: -1.8, aov: 121.4, aovGap: 2.4, ordC: -42, aovC: 58, refundRate: 2.18, refundOrders: 41, peerRefund: 2.2, dev: 29, onlineDev: 26, invDiff: -843, weeks: [229291, 227192, 226101, 230547, 227823, 229246], action: '保持常规监测（宽城紧凑档高产店）' },
  { id: 'S012', name: '宽城兴业街店', district: '宽城区', regionId: 'kuancheng', tier: 'compact', address: '兴业街北三环社区 · 紧凑型云值守', lat: 43.927, lng: 125.351, risk: 'normal', verdict: 'none', sales: 215565, baselineSales: 217951, salesGap: -1.1, orders: 1795, ordersGap: 0.6, aov: 120.1, aovGap: -1.7, ordC: 28, aovC: -72, refundRate: 2.15, refundOrders: 38, peerRefund: 2.2, dev: 28, onlineDev: 25, invDiff: -695, weeks: [213534, 214535, 218281, 218355, 217951, 215565], action: '保持常规监测（社区夜间云值守稳定）' },
  { id: 'S013', name: '二道吉林大路店', district: '二道区', regionId: 'erdao', tier: 'standard', address: '吉林大路亚泰商圈 · 高产标准店', lat: 43.878, lng: 125.374, risk: 'normal', verdict: 'none', sales: 374593, baselineSales: 380431, salesGap: -1.5, orders: 3019, ordersGap: -0.8, aov: 124.1, aovGap: -0.7, ordC: -54, aovC: -46, refundRate: 2.16, refundOrders: 65, peerRefund: 2.21, dev: 47, onlineDev: 42, invDiff: -1377, weeks: [373264, 377070, 374228, 374772, 380431, 374593], action: '保持常规监测（全城周销售额冠军门店）' },
  { id: 'S014', name: '二道自由大路店', district: '二道区', regionId: 'erdao', tier: 'standard', address: '自由大路体育场旁 · 社区标准店', lat: 43.864, lng: 125.388, risk: 'normal', verdict: 'none', sales: 330115, baselineSales: 328251, salesGap: 0.6, orders: 2626, ordersGap: -1.5, aov: 125.7, aovGap: 2.1, ordC: -41, aovC: 59, refundRate: 2.14, refundOrders: 56, peerRefund: 2.21, dev: 41, onlineDev: 36, invDiff: -1025, weeks: [335291, 323557, 331623, 323912, 328251, 330115], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S015', name: '二道临河街店', district: '二道区', regionId: 'erdao', tier: 'standard', address: '临河街经开核心段 · 高毛利标杆', lat: 43.854, lng: 125.378, risk: 'normal', verdict: 'none', sales: 370447, baselineSales: 368977, salesGap: 0.4, orders: 2945, ordersGap: 2.1, aov: 125.8, aovGap: -1.7, ordC: 56, aovC: -44, refundRate: 2.25, refundOrders: 67, peerRefund: 2.21, dev: 45, onlineDev: 39, invDiff: -1324, weeks: [366690, 370736, 366537, 371761, 368977, 370447], action: '保持常规监测（二道区高产能标杆）' },
  { id: 'S016', name: '二道远达大街店', district: '二道区', regionId: 'erdao', tier: 'standard', address: '远达大街红星美凯龙旁 · 社区无人仓', lat: 43.892, lng: 125.402, risk: 'normal', verdict: 'none', sales: 343876, baselineSales: 343561, salesGap: 0.1, orders: 2761, ordersGap: 1.2, aov: 124.5, aovGap: -1.1, ordC: 52, aovC: -48, refundRate: 2.29, refundOrders: 64, peerRefund: 2.21, dev: 42, onlineDev: 38, invDiff: -1159, weeks: [344245, 342542, 337946, 340411, 343561, 343876], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S017', name: '绿园景阳广场店', district: '绿园区', regionId: 'luyuan', tier: 'standard', address: '景阳大路地铁口 · 蓝海标准店', lat: 43.882, lng: 125.252, risk: 'normal', verdict: 'none', sales: 272799, baselineSales: 266230, salesGap: 2.5, orders: 2242, ordersGap: 0.7, aov: 121.7, aovGap: 1.7, ordC: 30, aovC: 70, refundRate: 2.06, refundOrders: 46, peerRefund: 2.19, dev: 35, onlineDev: 31, invDiff: -907, weeks: [269123, 266582, 269229, 268895, 266230, 272799], action: '保持常规监测（绿园蓝海回本标杆）' },
  { id: 'S018', name: '绿园和平大街店', district: '绿园区', regionId: 'luyuan', tier: 'standard', address: '和平大街春城大街交汇 · 园区高产店', lat: 43.874, lng: 125.236, risk: 'normal', verdict: 'none', sales: 282603, baselineSales: 284882, salesGap: -0.8, orders: 2319, ordersGap: 0.0, aov: 121.9, aovGap: -0.8, ordC: -5, aovC: -95, refundRate: 2.27, refundOrders: 53, peerRefund: 2.19, dev: 36, onlineDev: 32, invDiff: -1084, weeks: [280793, 278793, 282425, 282565, 284882, 282603], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S019', name: '绿园青年路店', district: '绿园区', regionId: 'luyuan', tier: 'standard', address: '青年路客车厂商圈 · 社区标准店', lat: 43.908, lng: 125.264, risk: 'normal', verdict: 'none', sales: 265529, baselineSales: 266262, salesGap: -0.3, orders: 2145, ordersGap: 0.3, aov: 123.8, aovGap: -0.6, ordC: 34, aovC: -66, refundRate: 2.22, refundOrders: 48, peerRefund: 2.19, dev: 33, onlineDev: 29, invDiff: -878, weeks: [266533, 264470, 266358, 263995, 266262, 265529], action: '保持常规监测（同城同行对标正常）' },
  { id: 'S020', name: '绿园西安大路西环店', district: '绿园区', regionId: 'luyuan', tier: 'standard', address: '西安大路西环城路旁 · 新兴低租店', lat: 43.896, lng: 125.228, risk: 'normal', verdict: 'none', sales: 272026, baselineSales: 277265, salesGap: -1.9, orders: 2224, ordersGap: -1.1, aov: 122.3, aovGap: -0.8, ordC: -58, aovC: -42, refundRate: 2.16, refundOrders: 48, peerRefund: 2.19, dev: 35, onlineDev: 31, invDiff: -952, weeks: [280488, 279198, 272048, 273354, 277265, 272026], action: '保持常规监测（新兴低租园区标杆）' },
]

const FALLBACK_STORES = [
  {
    id: 'A',
    name: '朝阳旗舰店',
    district: '朝阳区',
    regionId: 'chaoyang',
    storeTier: 'standard',
    address: '红旗街商圈 · 云值守无人仓',
    lat: 43.868,
    lng: 125.302,
    risk: 'possible',
    verdict: 'possible',
    sales: 172000,
    baselineSales: 238889,
    salesGap: -28,
    orders: 2140,
    ordersGap: -31,
    aov: 80.4,
    aovGap: 4,
    ordersContribution: -78,
    aovContribution: 16,
    refundRate: 7.0,
    refundOrderCount: 150,
    peerRefund: 2.1,
    deviceCount: 10,
    onlineDeviceCount: 10,
    onlineRate: 100,
    inventoryDiffAmount: -1200,
    openCase: true,
    taskStatus: 'open',
    impact: 28000,
    action: '抽查最近 20 笔退款订单并调取云值守夜间录像',
    owner: '区域经理 · 张伟',
    due: '24 小时内',
    caseId: 'case_A_001',
    taskId: 'task_001',
    trace: 'trace_20261018_A',
    dataSource: 'contract',
    trendSeries: [236400, 240100, 237800, 241200, 238889, 172000],
    peerSeries: [229000, 231500, 230200, 233100, 231800, 232400],
    ruleConditions: [
      { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: -28.0, unit: '%', hit: true },
      { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: 7.0, unit: '%', hit: true },
      { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: 4.0, unit: '%', hit: false },
    ],
  },
  {
    id: 'B',
    name: '南关生活店',
    district: '南关区',
    regionId: 'nanguan',
    storeTier: 'standard',
    address: '重庆路商圈 · 智能微超',
    lat: 43.871,
    lng: 125.332,
    risk: 'watch',
    verdict: 'insufficient',
    sales: 198000,
    baselineSales: 217582,
    salesGap: -9,
    orders: 2580,
    ordersGap: -7,
    aov: 76.7,
    aovGap: -2,
    ordersContribution: -74,
    aovContribution: -26,
    refundRate: 3.4,
    refundOrderCount: 88,
    peerRefund: 2.1,
    deviceCount: 8,
    onlineDeviceCount: 7,
    onlineRate: 87.5,
    inventoryDiffAmount: -450,
    openCase: true,
    taskStatus: 'assigned',
    impact: 9000,
    action: '核对本周促销记录并重启 03 号离线智能柜',
    owner: '门店店长 · 李明',
    due: '48 小时内',
    caseId: 'case_B_001',
    taskId: 'task_002',
    trace: 'trace_20261018_B',
    dataSource: 'contract',
    trendSeries: [215200, 218400, 216100, 219000, 217582, 198000],
    peerSeries: [214000, 216500, 215800, 217200, 216900, 215400],
    ruleConditions: [
      { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: -9.0, unit: '%', hit: false },
      { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: 3.4, unit: '%', hit: false },
      { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: -2.0, unit: '%', hit: false },
    ],
  },
  {
    id: 'C',
    name: '宽城北站店',
    district: '宽城区',
    regionId: 'kuancheng',
    storeTier: 'compact',
    address: '北站交通枢纽 · 24h云值守',
    lat: 43.913,
    lng: 125.331,
    risk: 'normal',
    verdict: 'none',
    sales: 224000,
    baselineSales: 211321,
    salesGap: 6,
    orders: 2910,
    ordersGap: 4,
    aov: 77.0,
    aovGap: 2,
    ordersContribution: 68,
    aovContribution: 32,
    refundRate: 1.8,
    refundOrderCount: 52,
    peerRefund: 2.1,
    deviceCount: 9,
    onlineDeviceCount: 9,
    onlineRate: 100,
    inventoryDiffAmount: -80,
    openCase: false,
    taskStatus: 'none',
    impact: 0,
    action: '保持当前经营节奏（可作为同城标杆样本）',
    owner: '店长',
    due: '无需处理',
    caseId: null,
    taskId: null,
    trace: 'trace_20261018_C',
    dataSource: 'contract',
    trendSeries: [206800, 208500, 210200, 209800, 211321, 224000],
    peerSeries: [208000, 209200, 208900, 210400, 209600, 210100],
    ruleConditions: [
      { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: 6.0, unit: '%', hit: false },
      { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: 1.8, unit: '%', hit: false },
      { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: 2.0, unit: '%', hit: false },
    ],
  },
  {
    id: 'D',
    name: '二道东盛店',
    district: '二道区',
    regionId: 'erdao',
    storeTier: 'standard',
    address: '东盛大街商圈 · 社区无人店',
    lat: 43.871,
    lng: 125.385,
    risk: 'normal',
    verdict: 'none',
    sales: 211000,
    baselineSales: 206863,
    salesGap: 2,
    orders: 2730,
    ordersGap: 1,
    aov: 77.3,
    aovGap: 1,
    ordersContribution: 55,
    aovContribution: 45,
    refundRate: 2.0,
    refundOrderCount: 57,
    peerRefund: 2.1,
    deviceCount: 8,
    onlineDeviceCount: 8,
    onlineRate: 100,
    inventoryDiffAmount: -110,
    openCase: false,
    taskStatus: 'none',
    impact: 0,
    action: '保持当前经营节奏',
    owner: '店长',
    due: '无需处理',
    caseId: null,
    taskId: null,
    trace: 'trace_20261018_D',
    dataSource: 'contract',
    trendSeries: [204100, 205800, 204900, 206200, 206863, 211000],
    peerSeries: [205000, 205400, 205900, 206100, 206500, 207200],
    ruleConditions: [
      { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: 2.0, unit: '%', hit: false },
      { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: 2.0, unit: '%', hit: false },
      { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: 1.0, unit: '%', hit: false },
    ],
  },
  {
    id: 'E',
    name: '绿园吾悦店',
    district: '绿园区',
    regionId: 'luyuan',
    storeTier: 'standard',
    address: '吾悦广场商圈 · 智能商超',
    lat: 43.888,
    lng: 125.258,
    risk: 'watch',
    verdict: 'insufficient',
    sales: 189000,
    baselineSales: 214772,
    salesGap: -12,
    orders: 2460,
    ordersGap: -14,
    aov: 76.8,
    aovGap: 2,
    ordersContribution: -85,
    aovContribution: 15,
    refundRate: 2.7,
    refundOrderCount: 66,
    peerRefund: 2.1,
    deviceCount: 7,
    onlineDeviceCount: 6,
    onlineRate: 85.7,
    inventoryDiffAmount: -260,
    openCase: false,
    taskStatus: 'none',
    impact: 12000,
    action: '检查工作日夜间客流与 1 台离线视觉结算台',
    owner: '店长',
    due: '48 小时内',
    caseId: null,
    taskId: null,
    trace: 'trace_20261018_E',
    dataSource: 'contract',
    trendSeries: [212400, 213900, 215100, 213600, 214772, 189000],
    peerSeries: [211000, 212500, 211800, 212900, 213200, 212600],
    ruleConditions: [
      { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: -12.0, unit: '%', hit: false },
      { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: 2.7, unit: '%', hit: false },
      { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: 2.0, unit: '%', hit: false },
    ],
  },
  ...CSV_STORE_SEED.map((s) => ({
    id: s.id,
    name: s.name,
    district: s.district,
    regionId: s.regionId,
    storeTier: s.tier,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    risk: s.risk,
    verdict: s.verdict,
    sales: s.sales,
    baselineSales: s.baselineSales,
    salesGap: s.salesGap,
    orders: s.orders,
    ordersGap: s.ordersGap,
    aov: s.aov,
    aovGap: s.aovGap,
    ordersContribution: s.ordC,
    aovContribution: s.aovC,
    refundRate: s.refundRate,
    refundOrderCount: s.refundOrders,
    peerRefund: s.peerRefund,
    deviceCount: s.dev,
    onlineDeviceCount: s.onlineDev,
    onlineRate: Number(((s.onlineDev / s.dev) * 100).toFixed(1)),
    inventoryDiffAmount: s.invDiff,
    openCase: s.verdict === 'possible',
    taskStatus: s.verdict === 'possible' ? 'open' : 'none',
    impact: s.id === 'S001' ? 123650 : s.id === 'S005' ? 8400 : 0,
    action: s.action,
    owner: s.verdict === 'unavailable' ? '数据工程组' : s.id === 'S001' ? '区域经理 · 张伟' : '区域督导',
    due: s.verdict === 'unavailable' ? '待补齐数据后重算' : s.id === 'S001' ? '24 小时内' : '常规周度巡检',
    caseId: s.id === 'S001' ? 'case_S001' : null,
    taskId: null,
    trace: `trace_csv_${s.id}`,
    verdictReason: s.verdictReason,
    dataSource: 'csv_datalayer',
    trendSeries: s.weeks,
    peerSeries: DISTRICT_PEER_SERIES[s.regionId] || DISTRICT_PEER_SERIES.chaoyang,
    ruleConditions:
      s.verdict === 'unavailable'
        ? []
        : [
            { id: 'sales_drop', label: '销售额环比跌幅 ≤ -18%', threshold: -18, actual: s.salesGap, unit: '%', hit: s.salesGap <= -18 },
            { id: 'refund_high', label: '退款率 ≥ 4.5% 且高于同行中位数 2pp', threshold: 4.5, actual: s.refundRate, unit: '%', hit: s.refundRate >= 4.5 },
            { id: 'aov_drop', label: '客单价环比跌幅 ≤ -12%', threshold: -12, actual: s.aovGap, unit: '%', hit: s.aovGap <= -12 },
          ],
  })),
]

const FALLBACK_REGIONS = [
  {
    regionId: 'chaoyang',
    regionName: '朝阳区',
    score: 86.5,
    demandScore: 92.0,
    competitionScore: 88.0,
    marginScore: 86.0,
    costScore: 46.7,
    capexInvestment: 360000,
    estimatedMonthlyProfit: 42800,
    estimatedPaybackMonths: 8.4,
    decision: '优先推荐投放',
    rationale: '高校与核心商圈集中，夜间云值守需求旺盛，确定性四维加权得分最高（86.5），预计 8.4 个月回本。',
    csvScore: 29.85,
    csvPaybackMonths: 5.8,
    csvMonthlyProfit: 230669,
    grade: 'standard',
    storeRadiusCount: 7,
    resourcePriority: 'ops_rescue',
    resourceTrackLabel: '存量运维抢修 #1 · 商圈高密区',
    allocationStrategy: '存量优先派遣巡检工程师核查 A店/S001 退款异常与 15 台离线设备；新店受限于半径内已达 7 家（竞争分仅 14.3）且月租+人力高达 ¥21.4万，建议暂缓盲目加密。',
    resourceFunnel: {
      dailySalesMedian: 48638,
      monthlyRevenueEst: 1480541,
      grossMarginRatio: 0.30,
      grossProfitEst: 444162,
      monthlyRent: 118000,
      monthlyLabor: 96000,
      totalMonthlyCost: 214000,
      netCashflow: 230669,
      deviceCountMedian: 42,
      capexPerDevice: 32000,
      totalCapexCsv: 1344000,
      costNote: '商圈成熟租赁成本高（半径内同档门店 7 家）',
    },
  },
  {
    regionId: 'kuancheng',
    regionName: '宽城区',
    score: 82.0,
    demandScore: 88.0,
    competitionScore: 82.0,
    marginScore: 84.0,
    costScore: 50.0,
    capexInvestment: 360000,
    estimatedMonthlyProfit: 38200,
    estimatedPaybackMonths: 9.4,
    decision: '推荐投放',
    rationale: '北站交通枢纽与大型成熟社区密集，租金成本可控，退款率低于同城中位数，预计 9.4 个月回本。',
    csvScore: 35.26,
    csvPaybackMonths: 5.3,
    csvMonthlyProfit: 168317,
    grade: 'compact',
    storeRadiusCount: 5,
    resourcePriority: 'compact_expansion',
    resourceTrackLabel: '紧凑型新店投放 #2 · 低成本快回本',
    allocationStrategy: '全区 4 家 CSV 门店（S009~S012）均为 compact 紧凑档，月租+人力仅 ¥11.5万，单店 CapEx 约 ¥89.6万，实测回本周期 5.3 个月，适合投放地铁口/枢纽型紧凑微超。',
    resourceFunnel: {
      dailySalesMedian: 31002,
      monthlyRevenueEst: 943689,
      grossMarginRatio: 0.30,
      grossProfitEst: 283107,
      monthlyRent: 71000,
      monthlyLabor: 44000,
      totalMonthlyCost: 115000,
      netCashflow: 168317,
      deviceCountMedian: 28,
      capexPerDevice: 32000,
      totalCapexCsv: 896000,
      costNote: '全区门店均为 compact 紧凑档，租赁与运维人力负担极低',
    },
  },
  {
    regionId: 'erdao',
    regionName: '二道区',
    score: 78.5,
    demandScore: 83.0,
    competitionScore: 80.0,
    marginScore: 81.0,
    costScore: 48.0,
    capexInvestment: 360000,
    estimatedMonthlyProfit: 33600,
    estimatedPaybackMonths: 10.7,
    decision: '稳健备选',
    rationale: '社区人口密度稳定，竞品覆盖率较低，履约成本适中，适合稳健型无人微超点位加密。',
    csvScore: 45.54,
    csvPaybackMonths: 5.7,
    csvMonthlyProfit: 249873,
    grade: 'standard',
    storeRadiusCount: 5,
    resourcePriority: 'high_margin_expansion',
    resourceTrackLabel: '标准型新店投放 #1 · CSV综合分最高',
    allocationStrategy: 'CSV 真实数据层四维综合得分全城第一（45.54），周均销售额中位数高达 ¥35.7万，单店月净现金流约 ¥25.0万，是标准型无人旗舰仓增量扩店的首选区域。',
    resourceFunnel: {
      dailySalesMedian: 51023,
      monthlyRevenueEst: 1553139,
      grossMarginRatio: 0.30,
      grossProfitEst: 465942,
      monthlyRent: 126000,
      monthlyLabor: 90000,
      totalMonthlyCost: 216000,
      netCashflow: 249873,
      deviceCountMedian: 43,
      capexPerDevice: 32000,
      totalCapexCsv: 1376000,
      costNote: '需求强度得分 87.5 全城最高，单店净现金流充沛',
    },
  },
  {
    regionId: 'luyuan',
    regionName: '绿园区',
    score: 74.0,
    demandScore: 80.0,
    competitionScore: 76.0,
    marginScore: 78.0,
    costScore: 55.3,
    capexInvestment: 360000,
    estimatedMonthlyProfit: 29400,
    estimatedPaybackMonths: 12.2,
    decision: '观察调优',
    rationale: '产业园区与吾悦商圈集中，周末客流充沛，但工作日夜间订单偏弱，需配合分时段促销。',
    csvScore: 32.32,
    csvPaybackMonths: 5.2,
    csvMonthlyProfit: 212499,
    grade: 'standard',
    storeRadiusCount: 3,
    resourcePriority: 'blue_ocean_expansion',
    resourceTrackLabel: '蓝海增量投放 · 5.2个月最快回本',
    allocationStrategy: '半径内同档门店仅 3 家（竞争压力最小，得分 71.4），标准店月租+人力仅 ¥14.2万（比朝阳低 33.6%），实测静态回本周期仅 5.2 个月（全城最快），适合蓝海抢占。',
    resourceFunnel: {
      dailySalesMedian: 38916,
      monthlyRevenueEst: 1184606,
      grossMarginRatio: 0.30,
      grossProfitEst: 355382,
      monthlyRent: 74000,
      monthlyLabor: 68000,
      totalMonthlyCost: 142000,
      netCashflow: 212499,
      deviceCountMedian: 35,
      capexPerDevice: 32000,
      totalCapexCsv: 1120000,
      costNote: '新兴区域成本低，半径内仅 3 家同档店，全城回本最快（5.2个月）',
    },
  },
  {
    regionId: 'nanguan',
    regionName: '南关区',
    score: 71.0,
    demandScore: 84.0,
    competitionScore: 74.0,
    marginScore: 78.0,
    costScore: 84.0,
    capexInvestment: null,
    estimatedMonthlyProfit: 26500,
    estimatedPaybackMonths: null,
    decision: '数据缺失·继续调研',
    rationale: '核心商圈租金较高（成本分 84.0），且缺少完整租金与物业基线数据，触发防幻觉铁律：回本周期置为 null，严禁强行编造。',
    csvScore: 26.06,
    csvPaybackMonths: 5.6,
    csvMonthlyProfit: 244629,
    grade: 'standard',
    storeRadiusCount: 6,
    resourcePriority: 'baseline_audit',
    resourceTrackLabel: '存量巡检与成本基线补齐区',
    allocationStrategy: '契约模式下因缺少完整物业基线触发回本周期置空（null）保护；建议先安排督导核查 B店/S005 重庆路店单指标退款波动，并补齐商圈物业杂费台账后再评估扩店。',
    resourceFunnel: {
      dailySalesMedian: 48480,
      monthlyRevenueEst: 1475739,
      grossMarginRatio: 0.30,
      grossProfitEst: 442722,
      monthlyRent: 105000,
      monthlyLabor: 92000,
      totalMonthlyCost: 197000,
      netCashflow: 244629,
      deviceCountMedian: 42,
      capexPerDevice: 32000,
      totalCapexCsv: 1344000,
      costNote: '办公与核心商圈租金中位（契约模式下缺物业基线触发 null 保护）',
    },
  },
]

const FALLBACK_TASKS = [
  {
    taskId: 'task_001',
    sourceCaseId: 'case_A_001',
    storeId: 'A',
    storeName: '朝阳旗舰店',
    deviceId: 'device-A-001',
    regionName: '朝阳区',
    priority: 'P1',
    severity: 'high',
    problem: '退款率 7.0% 显著高于同城可比中位数（2.1%），且云值守盘点差异达 -¥1,200',
    evidenceIds: ['EV-REFUND-001', 'EV-PEER-001', 'EV-CLOUD-GUARD-001'],
    evidenceDetails: [
      { id: 'EV-REFUND-001', label: '近7天退款率 vs 同行中位数', value: '7.0% (+4.9pp)' },
      { id: 'EV-ORDER-002', label: '销售额拆解 · 订单数贡献', value: '-78% (周环比 -31%)' },
      { id: 'EV-CLOUD-003', label: '云值守货柜盘点差异 (防损告警)', value: '-¥1,200 (150笔退款单)' },
    ],
    action: '抽查最近 20 笔退款订单并调取云值守夜间视觉防损录像核对原因',
    ownerRole: '区域经理 · 张伟',
    dueHours: 24,
    dueLabel: '24 小时内',
    verifyMetric: 'refund_rate',
    verifyTarget: '下一周期退款率回落至同类中位数 + 2 个百分点以内（<= 4.1%）',
    status: 'open',
    traceId: 'trace_20261018_A',
    updatedAt: '10:32:08',
    history: [
      { at: '10:30:12', step: 'audit_detected', text: '规则引擎 store_anomaly_v1 命中 2 项条件，自动生成待确认行动卡' },
    ],
    verificationResult: null,
  },
]

const riskMeta = {
  possible: { label: '可能异常', color: '#d24a44', soft: '#fde9e7' },
  watch: { label: '需要关注', color: '#bd7b13', soft: '#fff5df' },
  normal: { label: '运行正常', color: '#258b68', soft: '#e7f5ef' },
  unavailable: { label: '数据不足', color: '#64748b', soft: '#eef2f6' },
}

const taskStatusMeta = {
  open: { label: '待人工确认', color: '#c74743', soft: '#fde9e7', stepIndex: 0 },
  assigned: { label: '已派发待接单', color: '#bd7b13', soft: '#fff5df', stepIndex: 1 },
  investigating: { label: '现场/云值守核查中', color: '#2563eb', soft: '#dbeafe', stepIndex: 2 },
  verifying: { label: '待下一周期复核', color: '#7c3aed', soft: '#ede9fe', stepIndex: 3 },
  closed: { label: '已达标关闭', color: '#258b68', soft: '#e7f5ef', stepIndex: 4 },
  escalated: { label: '复核未过·已升级P0', color: '#be123c', soft: '#ffe4e6', stepIndex: 4 },
}

const QUICK_PROMPTS = [
  { label: '异常根因诊断', query: '为什么朝阳店最近销售额掉得这么厉害？' },
  { label: '长春选址 ROI', query: '长春哪个区最适合新开门店？南关区能算回本周期吗？' },
  { label: 'S001 vs S004 实测', query: '对比 S001 和 S004 的规则引擎判定结果' },
  { label: '派发整改任务', query: '如果采纳建议，给区域经理建个核查任务' },
  { label: '下一周期复核', query: '复核上周异常整改进展，能关单吗？' },
]

/**
 * 顶部 KPI 卡片内嵌的轻量 SVG Sparkline 微型趋势线
 */
function KpiSparkline({ points = [], color = '#258b68' }) {
  if (!points || points.length < 2) return null
  const width = 88
  const height = 28
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = Math.max(max - min, 1)
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * (width - 8) + 4
    const y = height - 4 - ((v - min) / range) * (height - 8)
    return [x, y]
  })
  const linePath = coords.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`
  const last = coords[coords.length - 1]

  return (
    <svg className="kpi-sparkline-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={areaPath} fill={color} fillOpacity="0.11" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.8" fill={color} />
    </svg>
  )
}

/**
 * 42天（6周 W1~W6）本店销售额 vs 同城同行中位数 双轨面积趋势图 (SVG)
 */
function StoreTrendChart({ store, compact = false }) {
  const weeksLabels = ['W1 (9.01)', 'W2 (9.08)', 'W3 (9.15)', 'W4 (9.22)', 'W5 (前7日)', 'W6 (近7日)']
  const rawSeries = store?.trendSeries || [220000, 224000, 221000, 225000, store?.baselineSales || 228000, store?.sales]
  const peerSeries = store?.peerSeries || DISTRICT_PEER_SERIES[store?.regionId] || DISTRICT_PEER_SERIES.chaoyang
  const isUnavail = store?.risk === 'unavailable'

  const validVals = [...rawSeries.filter((v) => typeof v === 'number'), ...peerSeries.filter((v) => typeof v === 'number')]
  const minVal = validVals.length ? Math.min(...validVals) * 0.88 : 100000
  const maxVal = validVals.length ? Math.max(...validVals) * 1.06 : 400000
  const range = Math.max(maxVal - minVal, 1)

  const W = compact ? 480 : 540
  const H = compact ? 156 : 184
  const padL = 48
  const padR = 18
  const padT = 18
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const toX = (i) => padL + (i / 5) * innerW
  const toY = (v) => padT + innerH - ((v - minVal) / range) * innerH

  const storePts = rawSeries
    .map((v, i) => (typeof v === 'number' ? { i, x: toX(i), y: toY(v), v } : null))
    .filter(Boolean)
  const peerPts = peerSeries
    .map((v, i) => (typeof v === 'number' ? { i, x: toX(i), y: toY(v), v } : null))
    .filter(Boolean)

  const storeLine = storePts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const storeArea =
    storePts.length > 1
      ? `${storeLine} L${storePts[storePts.length - 1].x.toFixed(1)},${padT + innerH} L${storePts[0].x.toFixed(1)},${padT + innerH} Z`
      : ''
  const peerLine = peerPts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const strokeColor =
    store?.risk === 'possible' ? '#c74743' : store?.risk === 'watch' ? '#bd7b13' : store?.risk === 'unavailable' ? '#64748b' : '#258b68'

  return (
    <div className="svg-trend-chart-wrap">
      <div className="svg-trend-legend">
        <span className="legend-chip">
          <i style={{ background: strokeColor }} />
          {store?.id} 本店周度销售额 (W1—W6)
        </span>
        <span className="legend-chip">
          <i className="dashed-line-icon" />
          {store?.district}可比同行中位数基准
        </span>
        {isUnavail && <span className="wb-badge err">W6 关键流水缺失 · 已阻断外推</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="store-trend-svg">
        {[0, 0.5, 1].map((ratio, idx) => {
          const y = padT + ratio * innerH
          const val = Math.round((maxVal - ratio * range) / 1000)
          return (
            <g key={idx}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="svg-axis-text">
                ¥{val}k
              </text>
            </g>
          )
        })}

        {peerLine && (
          <path d={peerLine} fill="none" stroke="#64748b" strokeWidth="1.8" strokeDasharray="5 4" />
        )}
        {storeArea && <path d={storeArea} fill={strokeColor} fillOpacity="0.10" />}
        {storeLine && (
          <path d={storeLine} fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {peerPts.map((p) => (
          <circle key={`peer-${p.i}`} cx={p.x} cy={p.y} r="2.6" fill="#ffffff" stroke="#64748b" strokeWidth="1.5" />
        ))}

        {storePts.map((p, idx) => {
          const isLast = idx === storePts.length - 1
          return (
            <g key={`st-${p.i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isLast ? 4.8 : 3.4}
                fill={isLast ? strokeColor : '#ffffff'}
                stroke={strokeColor}
                strokeWidth="2"
              />
              {(isLast || p.i === 4) && (
                <text
                  x={p.x}
                  y={p.y - 9}
                  textAnchor={p.i === 5 ? 'end' : 'middle'}
                  className="svg-val-label"
                  fill={isLast ? strokeColor : '#334155'}
                >
                  ¥{(p.v / 1000).toFixed(1)}k
                </text>
              )}
            </g>
          )
        })}

        {isUnavail && (
          <g>
            <rect x={toX(4.3)} y={padT} width={toX(5) - toX(4.3) + 8} height={innerH} fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="3 3" rx="4" />
            <text x={toX(4.65)} y={padT + innerH / 2 + 4} textAnchor="middle" className="svg-missing-label">
              W6 缺失拦截
            </text>
          </g>
        )}

        {weeksLabels.map((lbl, i) => (
          <text key={lbl} x={toX(i)} y={H - 7} textAnchor="middle" className="svg-axis-text">
            {lbl}
          </text>
        ))}
      </svg>
    </div>
  )
}

/**
 * 规则引擎 store_anomaly_v1 三项异常条件共振命中矩阵
 */
function RuleMatrixCard({ store }) {
  const conditions = store?.ruleConditions || []
  const hitCount = conditions.filter((c) => c.hit).length
  const verdictMap = {
    possible: { text: 'possible · 疑似异常（命中 ≥2 项）', cls: 'err' },
    insufficient: { text: 'insufficient · 证据不足（仅单指标波动）', cls: 'warn' },
    none: { text: 'none · 运行正常（0 项命中）', cls: 'ok' },
    unavailable: { text: 'unavailable · 数据缺失保护（禁止归因）', cls: 'info' },
  }
  const vMeta = verdictMap[store?.verdict] || verdictMap.none

  return (
    <div className="rule-matrix-box">
      <div className="rule-matrix-head">
        <div>
          <span className="subsection-label">规则引擎 store_anomaly_v1 · 三态判定矩阵</span>
          <strong>已命中 {hitCount} / 3 项阈值条件</strong>
        </div>
        <span className={`wb-badge ${vMeta.cls}`}>{vMeta.text}</span>
      </div>
      {store?.verdict === 'unavailable' ? (
        <div className="rule-unavailable-note">
          <Lock size={15} />
          <span>核心流水字段（退款金额/笔数）为空，已强制阻断规则阈值计算，防止将缺失当作 0% 误判。</span>
        </div>
      ) : (
        <div className="rule-cond-grid">
          {conditions.map((cond) => (
            <div key={cond.id} className={`rule-cond-item ${cond.hit ? 'hit' : 'pass'}`}>
              <div className="rule-cond-top">
                <span className="wb-mono">{cond.id}</span>
                <span className={`rule-hit-pill ${cond.hit ? 'hit' : 'pass'}`}>
                  {cond.hit ? '命中阈值' : '未命中'}
                </span>
              </div>
              <div className="rule-cond-label">{cond.label}</div>
              <div className="rule-cond-vals">
                <span>
                  实测值：
                  <strong className={cond.hit ? 'negative-text' : 'positive-text'}>
                    {cond.actual !== null && cond.actual !== undefined
                      ? `${cond.actual > 0 && cond.id !== 'refund_high' ? '+' : ''}${cond.actual}${cond.unit || '%'}`
                      : '—'}
                  </strong>
                </span>
                <span>阈值：{cond.threshold}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MapViewport({ selectedId, selectedDistrict, stores }) {
  const map = useMap()
  useEffect(() => {
    if (selectedId) {
      const store = stores.find((item) => item.id === selectedId)
      if (store && store.lat && store.lng) {
        map.flyTo([store.lat, store.lng], 12.2, { duration: 0.45 })
        return
      }
    }
    if (selectedDistrict && DISTRICT_META[selectedDistrict]) {
      map.flyTo(DISTRICT_META[selectedDistrict].center, 11.8, { duration: 0.45 })
    }
  }, [map, selectedId, selectedDistrict, stores])
  return null
}

function Metric({ label, value, suffix = '', delta, tone = 'neutral' }) {
  return (
    <div className="metric-block">
      <span>{label}</span>
      <strong>
        {value}
        {suffix}
      </strong>
      {delta !== undefined && delta !== null && (
        <em className={`delta ${tone}`}>
          {delta > 0 ? '+' : ''}
          {Number(delta).toFixed(1).replace(/\.0$/, '')}%
        </em>
      )}
    </div>
  )
}

function App() {
  const [overview, setOverview] = useState({
    dataVersion: 'demo_v1',
    updatedAt: '10:32:08',
    dashboard: {
      totalSales: 1001220,
      estimatedProfit: 320390,
      activeDevices: 40,
      totalDevices: 42,
      onlineRate: 95.2,
      totalInventoryDiffAmount: -2100,
      cloudGuardActiveCount: 5,
    },
    stores: FALLBACK_STORES,
    regions: FALLBACK_REGIONS,
    tasks: FALLBACK_TASKS,
  })
  const [selectedId, setSelectedId] = useState('A')
  const [selectedDistrict, setSelectedDistrict] = useState('all')
  const [mapTileMode, setMapTileMode] = useState('amap_road')
  const [compareIds, setCompareIds] = useState([])
  const [view, setView] = useState('map')
  const [query, setQuery] = useState('')
  const [storeSourceFilter, setStoreSourceFilter] = useState('all')
  const [caseOpen, setCaseOpen] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState('task_001')

  // AI 问数与诊断快捷栏 + 右下角可缩放 Agent 浮窗共享状态
  const [agentInput, setAgentInput] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentResult, setAgentResult] = useState(null)
  const [copilotSize, setCopilotSize] = useState('normal') // 'minimized' | 'normal' | 'expanded'
  const [copilotMessages, setCopilotMessages] = useState([
    {
      role: 'assistant',
      at: '10:30',
      summary:
        '您好！我是莱森云值守经营 Copilot。当前已同步长春市五区（朝阳/南关/宽城/二道/绿园）共 26 家门店（5 家标杆店 + 21 家实测店）近 42 天流水与防损数据。您可以用自然语言自由提问任何经营、归因或选址问题。',
      thinkingSteps: [
        {
          phase: 'thinking',
          title: '思考环节 · 初始化全城五区经营监测上下文',
          detail: '锁定长春市五区 26 家无人零售网点与云值守终端监控范围，准备响应自由问数与诊断诉求。',
          status: 'done',
          durationMs: 35,
        },
        {
          phase: 'query',
          title: '数据查询 · 同步近 42 天门店流水与同城可比基线',
          detail: '已完成全城周度销售额、退款率、云值守盘点差异及五区选址四维指标同步。',
          status: 'done',
          durationMs: 92,
        },
        {
          phase: 'retry',
          title: '执行状态与重试校验 · 数据完整性核验与缺失保护',
          detail: '检测到 S004/E 店部分周期核心退款流水缺失，已自动启用防编造熔断保护，杜绝虚假归因。',
          status: 'retried',
          durationMs: 48,
        },
        {
          phase: 'analysis',
          title: '分析步骤 · 生成高风险门店预警与区域投放优先级',
          detail: '定位朝阳旗舰店与 S001 店为多指标共振高优异常，同时完成五区投资回本周期排序。',
          status: 'done',
          durationMs: 74,
        },
      ],
      structuredBlocks: {
        questionFocus: '全城 26 店经营体检与区域投放全景速览',
        directAnswer:
          '当前全城近 7 天总销售额 ¥1,001,220，云值守终端在线率 95.2%。其中朝阳旗舰店（A店）与 S001 店出现销售额下滑、退款率偏高及盘点差异三项共振异常；增量开店方面，朝阳区综合评分 86.5 分居首（预计 8.4 个月回本），南关区因缺少投资额基线已触发回本周期暂缓估算保护。',
        keyMetrics: [
          { label: '全城周总销售额', value: '¥1,001,220', trend: 'neutral' },
          { label: '高优异常门店', value: 'A店 / S001店', trend: 'negative' },
          { label: '缺失保护门店', value: 'S004 / E店', trend: 'warning' },
          { label: '首选投放区域', value: '朝阳区 (86.5分)', trend: 'positive' },
        ],
        diagnosisItems: [],
        comparisonRows: [],
      },
      decisionProposal: {
        proposalType: 'store_rectification_plan',
        title: '高优异常门店（朝阳旗舰店 / S001）专项防损核查方案',
        targetLabel: '朝阳旗舰店 (A店)',
        decisionBasis: [
          '近 7 天销售额环比下滑 24%，退款率升至 7.0%（高于同区同行中位数 2.1% 达 4.9 个百分点）',
          '订单数变动贡献度达 -78%，云值守夜间货柜盘点差异达 -¥1,200',
        ],
        analysis:
          '通过双因子拆解确认销售额下滑并非客单价波动所致，而是夜间订单流失与异常退款集中爆发引起，需优先排查夜间视觉防损告警录像与 02 号冷柜锁控状态。',
        expectedImpact:
          '预计 24 小时内修复异常锁控并拦截重复退款后，门店退款率可回落至 4.1% 安全线以内，周销售额预计挽回约 ¥18,000。',
        ownerRole: '区域经理 · 张伟',
        dueHours: 24,
        primaryActionLabel: '批准并派发整改任务',
        secondaryActionLabel: '暂缓执行',
      },
      evidence: ['A店/S001 命中3项异常规则', 'S004/E店 触发缺失保护', '朝阳区选址评分 Top 1'],
      recommendations: ['抽查朝阳店近 20 笔异常退款单并调取云值守夜间录像'],
    },
  ])
  const [actionBusy, setActionBusy] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)

  async function fetchOverview() {
    try {
      const res = await fetch('/api/v1/operations/overview')
      if (!res.ok) return
      const data = await res.json()
      if (data && Array.isArray(data.stores)) {
        setOverview(data)
      }
    } catch {
      // 保留初始回退数据
    }
  }

  useEffect(() => {
    fetchOverview()
  }, [])

  function showToast(text) {
    setToastMsg(text)
    setTimeout(() => {
      setToastMsg((prev) => (prev === text ? null : prev))
    }, 3800)
  }

  async function runQuickAgent(customQuery, fromCopilot = false) {
    const q = (customQuery ?? agentInput).trim()
    if (!q) return
    if (!fromCopilot) setAgentInput(q)
    setAgentLoading(true)

    // 当用户使用“这家店 / 当前门店 / 本店”等指代词时，自动绑定当前选中的门店上下文
    const contextualQuery = /(这家门店|这家店|当前门店|当前店|本店)/.test(q)
      ? q.replace(/(这家门店|这家店|当前门店|当前店|本店)/g, `${selected?.id || 'A'}店（${selected?.name || '朝阳旗舰店'}）`)
      : q

    setCopilotMessages((prev) => [
      ...prev,
      {
        role: 'user',
        at: new Date().toTimeString().slice(0, 5),
        text: q,
        contextLabel: `${selected?.id || 'A'} · ${selected?.district || '朝阳区'}`,
      },
    ])
    try {
      const res = await fetch('/api/v1/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: contextualQuery,
          sessionId: 'workspace_copilot_session',
          context: {
            regionId: selected?.regionId || 'chaoyang',
            storeId: selected?.id || 'A',
          },
        }),
      })
      const data = await res.json()
      setAgentResult(data)
      setCopilotMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          at: new Date().toTimeString().slice(0, 5),
          summary: data.summary || '已完成业务数据核验与归因分析。',
          thinkingSteps: data.thinkingSteps || [],
          structuredBlocks: data.structuredBlocks || null,
          decisionProposal: data.decisionProposal || null,
          findings: data.findings || [],
          regionComparison: data.regionComparison || [],
          assumptions: data.assumptions || [],
          evidence: data.evidence || [],
          recommendations: data.recommendations || [],
        },
      ])
    } catch (err) {
      const fallbackMsg = `请求失败：${err?.message || '网络异常'}`
      setAgentResult({
        summary: fallbackMsg,
        thinkingSteps: [
          {
            phase: 'retry',
            title: '执行状态与失败重试 · 网络通信异常拦截',
            detail: `服务端连接暂时不可用（${err?.message || '网络异常'}），已启动本地防幻觉保护，不生成未经证实的结论。`,
            status: 'degraded',
            durationMs: 120,
          },
        ],
        structuredBlocks: {
          questionFocus: q,
          directAnswer: fallbackMsg,
          keyMetrics: [],
          diagnosisItems: [],
          comparisonRows: [],
        },
        evidence: [],
        recommendations: [],
      })
      setCopilotMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          at: new Date().toTimeString().slice(0, 5),
          summary: fallbackMsg,
          thinkingSteps: [
            {
              phase: 'retry',
              title: '执行状态与失败重试 · 网络通信异常拦截',
              detail: `服务端连接暂时不可用（${err?.message || '网络异常'}），已启动本地防幻觉保护。`,
              status: 'degraded',
              durationMs: 120,
            },
          ],
          evidence: [],
          recommendations: [],
        },
      ])
    } finally {
      setAgentLoading(false)
    }
  }

  function handleApproveDecisionProposal(proposal, responseObj) {
    if (!proposal) return
    if (proposal.proposalType === 'region_investment_plan') {
      triggerTaskAction('create_from_agent', {
        customTask: {
          storeId: selected?.id || 'A',
          storeName: `${proposal.targetLabel || '首选区域'} · 新店筹建组`,
          regionName: proposal.targetLabel || selected?.district || '朝阳区',
          problem: `${proposal.title}：${(proposal.decisionBasis || [])[0] || '依据四维选址评分模型推进落位'}`,
          action: `采纳区域投放方案并启动点位勘测与物业排期（预期：${proposal.expectedImpact || '按测算周期回本'}）`,
          ownerRole: proposal.ownerRole || '城市拓展总监 · 赵鹏',
        },
      })
      showToast(`已确认采纳「${proposal.title}」，并同步生成拓展执行工单`)
    } else {
      triggerTaskAction('create_from_agent', {
        customTask: {
          storeId: selected?.id || 'A',
          storeName: proposal.targetLabel || selected?.name || '朝阳旗舰店',
          regionName: selected?.district || '朝阳区',
          problem: (proposal.decisionBasis || [])[0] || responseObj?.summary?.slice(0, 88) || '门店多项经营与防损指标偏离同行基线',
          action:
            responseObj?.recommendations?.[0] ||
            proposal.analysis ||
            '抽查异常退款订单并调取云值守夜间录像核对原因',
          ownerRole: proposal.ownerRole || '区域经理 · 张伟',
        },
      })
    }
  }

  async function triggerTaskAction(actionType, extra = {}) {
    setActionBusy(true)
    try {
      const res = await fetch('/api/v1/operations/task-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: extra.taskId || activeTaskId,
          storeId: extra.storeId || selectedId,
          actionType,
          customTask: extra.customTask,
        }),
      })
      const data = await res.json()
      if (data && data.ok) {
        if (data.task?.taskId) {
          setActiveTaskId(data.task.taskId)
        }
        await fetchOverview()
        if (data.message) {
          showToast(data.message)
        } else if (actionType === 'confirm_assign') {
          showToast('已确认并派发行动任务至区域经理')
        } else if (actionType === 'verify_improved') {
          showToast('下一周期复核通过：退款率回落至 2.8%，案件已自动关闭')
        } else if (actionType === 'verify_unresolved') {
          showToast('下一周期复核未达标：已保留证据链并升级为 P0 督办')
        }
      }
    } finally {
      setActionBusy(false)
    }
  }

  const stores = overview.stores || FALLBACK_STORES
  const regions = overview.regions || FALLBACK_REGIONS
  const tasks = overview.tasks || FALLBACK_TASKS
  const dashboard = overview.dashboard || {}

  const selected = stores.find((item) => item.id === selectedId) || stores[0]
  const comparableStores = useMemo(
    () => stores.filter((item) => item.risk !== 'unavailable' && item.sales !== null),
    [stores]
  )
  const compareStores = useMemo(
    () => compareIds.map((id) => stores.find((item) => item.id === id)).filter(Boolean),
    [compareIds, stores]
  )
  const peerMedian = useMemo(() => {
    const sameDistrictPeers = comparableStores.filter(
      (item) => item.id !== selected.id && item.regionId === selected.regionId
    )
    const pool = sameDistrictPeers.length > 0 ? sameDistrictPeers : comparableStores
    return Math.round(pool.reduce((sum, item) => sum + (item.sales || 0), 0) / Math.max(pool.length, 1))
  }, [comparableStores, selected.id, selected.regionId])

  const trendRate = (selected.salesGap || 0) / 100
  const projected = selected.sales ? Math.round(selected.sales * (1 + trendRate)) : null
  const targetGap = projected !== null ? projected - peerMedian : null

  function toggleCompare(id) {
    setCompareIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current
    )
  }

  function selectStore(id, switchToDetail = true) {
    setSelectedId(id)
    const matchedTask = tasks.find((t) => t.storeId === id)
    if (matchedTask) setActiveTaskId(matchedTask.taskId)
    if (switchToDetail) {
      setView('detail')
    }
  }

  function openStoreCase(storeObj = selected) {
    const matchedTask = tasks.find((t) => t.storeId === storeObj.id) || tasks[0]
    if (matchedTask) setActiveTaskId(matchedTask.taskId)
    setCaseOpen(true)
  }

  const filtered = stores.filter((store) => {
    const matchText = `${store.name}${store.district}${store.id}${store.address}`.toLowerCase().includes(query.toLowerCase())
    if (!matchText) return false
    if (selectedDistrict !== 'all' && store.regionId !== selectedDistrict) return false
    if (storeSourceFilter === 'contract') return store.dataSource === 'contract'
    if (storeSourceFilter === 'csv') return store.dataSource === 'csv_datalayer'
    return true
  })

  const mapVisibleStores = useMemo(() => {
    return stores.filter((st) => {
      if (selectedDistrict !== 'all' && st.regionId !== selectedDistrict) return false
      if (storeSourceFilter === 'contract') return st.dataSource === 'contract'
      if (storeSourceFilter === 'csv') return st.dataSource === 'csv_datalayer'
      return true
    })
  }, [stores, selectedDistrict, storeSourceFilter])

  const sameDistrictPeersForLines = useMemo(() => {
    if (!selected || !selected.lat || !selected.lng) return []
    return mapVisibleStores.filter(
      (st) => st.id !== selected.id && st.regionId === selected.regionId && st.lat && st.lng
    )
  }, [selected, mapVisibleStores])

  const openTaskCount = tasks.filter((t) => t.status !== 'closed').length
  const activeTask = tasks.find((t) => t.taskId === activeTaskId) || tasks.find((t) => t.storeId === selected.id) || tasks[0]
  const contractCount = stores.filter((s) => s.dataSource === 'contract').length
  const csvCount = stores.filter((s) => s.dataSource === 'csv_datalayer').length

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={18} />
          </div>
          <div>
            <strong>莱森地平线 · 云值守经营智能体</strong>
            <span>LAISEN TECH · UNMANNED RETAIL &amp; CLOUD GUARD OPS</span>
          </div>
        </div>
        <div className="topbar-context">
          <span className="live-dot" />
          实时契约与 CSV 全量底座 · 长春市五区（{contractCount} 家标杆店 + {csvCount} 家 CSV 实测店 = {stores.length} 店）
          <span className="divider" />
          版本 {overview.dataVersion} · 更新于 {overview.updatedAt}
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="行动中心通知" onClick={() => setCaseOpen(true)}>
            <Bell size={17} />
            {openTaskCount > 0 && <span className="notification-dot" />}
          </button>
          <div className="avatar">RM</div>
          <span className="role">区域运营总监</span>
        </div>
      </header>

      {toastMsg && (
        <div className="ops-toast">
          <CheckCircle2 size={15} />
          <span>{toastMsg}</span>
        </div>
      )}

      <main className="workspace">
        <aside className="sidebar">
          <div className="side-intro">
            <div className="eyebrow">LAISEN CLOUD GUARD / 01</div>
            <h1>
              无人零售
              <br />
              <span>诊断与选址闭环</span>
            </h1>
            <p>打通云值守防损盘点、同城可比门店诊断、确定性选址 ROI 与行动复核闭环。</p>
          </div>

          <nav className="nav-list">
            <button
              className={`nav-item ${view === 'map' || view === 'detail' ? 'active' : ''}`}
              onClick={() => setView('map')}
            >
              <MapPin size={17} />
              风险地图与巡检
              <span className="nav-count">{stores.length}</span>
            </button>
            <button className={`nav-item ${view === 'compare' ? 'active' : ''}`} onClick={() => setView('compare')}>
              <Users size={17} />
              同城门店对标
            </button>
            <button className={`nav-item ${view === 'regions' ? 'active' : ''}`} onClick={() => setView('regions')}>
              <Target size={17} />
              区域投放决策 (ROI)
              <span className="nav-count">5区</span>
            </button>
            <button className={`nav-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}>
              <ShieldAlert size={17} />
              经营行动中心
              <span className={`nav-count ${openTaskCount > 0 ? 'danger' : ''}`}>{openTaskCount}</span>
            </button>
            <button
              className={`nav-item ${view === 'workbench' ? 'active' : ''}`}
              onClick={() => setView('workbench')}
            >
              <Gauge size={17} />
              Agent 七层检测台
              <span className="nav-count">7层</span>
            </button>
            <button className={`nav-item ${view === 'agent-loop' ? 'active' : ''}`} onClick={() => setView('agent-loop')}>
              <Activity size={17} />
              Agent 主动监控
              <span className="nav-count">Loop</span>
            </button>
          </nav>

          <div className="sidebar-section">
            <div className="section-label">数据契约范围</div>
            <div className="scope-card">
              <div>
                <span>业务域</span>
                <strong>莱森购 · 24h云值守无人超</strong>
              </div>
              <CheckCircle2 size={15} className="ok-icon" />
            </div>
            <div className="scope-card">
              <div>
                <span>观察窗口</span>
                <strong>
                  42天基线 <small>W1(9.01) — W6(10.12)</small>
                </strong>
              </div>
              <ChevronRight size={15} />
            </div>
          </div>

          <div className="sidebar-section store-list-section">
            <div className="section-row">
              <div className="section-label">
                门店与无人仓列表 <span>{filtered.length}</span>
              </div>
              <SlidersHorizontal size={14} className="muted-icon" />
            </div>

            <div className="source-filter-pills">
              <button
                className={storeSourceFilter === 'all' ? 'active' : ''}
                onClick={() => setStoreSourceFilter('all')}
              >
                全部({stores.length})
              </button>
              <button
                className={storeSourceFilter === 'contract' ? 'active' : ''}
                onClick={() => setStoreSourceFilter('contract')}
              >
                标杆店({contractCount})
              </button>
              <button
                className={storeSourceFilter === 'csv' ? 'active' : ''}
                onClick={() => setStoreSourceFilter('csv')}
              >
                CSV实测({csvCount})
              </button>
            </div>

            <div className="district-mini-pills">
              <button
                className={selectedDistrict === 'all' ? 'active' : ''}
                onClick={() => setSelectedDistrict('all')}
              >
                全城五区
              </button>
              {Object.entries(DISTRICT_META).map(([rId, meta]) => (
                <button
                  key={rId}
                  className={selectedDistrict === rId ? 'active' : ''}
                  onClick={() => setSelectedDistrict(selectedDistrict === rId ? 'all' : rId)}
                >
                  {meta.name.replace('区', '')}
                </button>
              ))}
            </div>

            <div className="search-box">
              <Search size={14} />
              <input
                placeholder="搜索门店 ID (如 S001/S004)、商圈或区域"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="store-list">
              {filtered.map((store) => {
                const rMeta = riskMeta[store.risk] || riskMeta.normal
                return (
                  <button
                    className={`store-row ${selected.id === store.id ? 'selected' : ''}`}
                    key={store.id}
                    onClick={() => selectStore(store.id, view === 'detail')}
                    onDoubleClick={() => selectStore(store.id, true)}
                  >
                    <span className="mini-status" style={{ background: rMeta.color }} />
                    <span className="store-row-name">
                      <strong>
                        {store.id} · {store.name}
                      </strong>
                      <small>
                        {store.district} · {store.address}
                      </small>
                    </span>
                    <span
                      className="store-row-gap"
                      style={{
                        color:
                          store.risk === 'unavailable'
                            ? '#64748b'
                            : store.salesGap < -15
                              ? '#c74743'
                              : store.salesGap < 0
                                ? '#ad7617'
                                : '#258b68',
                      }}
                    >
                      {store.risk === 'unavailable'
                        ? '缺失'
                        : `${store.salesGap > 0 ? '+' : ''}${store.salesGap}%`}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="integrity">
              <span className="integrity-ring">92%</span>
              <div>
                <strong>数据完整度保护</strong>
                <small>
                  {comparableStores.length} 店可比 · {stores.length - comparableStores.length} 店缺失拦截
                </small>
              </div>
            </div>
            <button className="help-button" title="查看架构与契约检测台" onClick={() => setView('workbench')}>
              <CircleHelp size={16} />
            </button>
          </div>
        </aside>

        <section className="main-panel">
          <div className="main-toolbar">
            <div>
              <div className="breadcrumb">
                莱森地平线 <ChevronRight size={14} />{' '}
                <span>
                  {view === 'workbench'
                    ? '成员 C · Agent 七层架构与契约检测台'
                    : view === 'agent-loop'
                      ? '设备事件驱动 · Agent 主动监控与 SLA 闭环'
                    : view === 'regions'
                      ? '确定性多因子区域选址与资源投放漏斗'
                      : view === 'tasks'
                        ? '异常案件派单与下一周期复核闭环'
                        : '无人零售与云值守经营驾驶舱'}
                </span>
              </div>
              <h2>
                {view === 'workbench'
                  ? 'Agent 七层架构与 API 契约检测台'
                  : view === 'agent-loop'
                    ? 'Agent 主动监控与行动闭环'
                  : view === 'compare'
                    ? '同城可比门店横向对标'
                    : view === 'regions'
                      ? '长春市 5 大行政区资源投放漏斗与回本周期测算'
                      : view === 'tasks'
                        ? '经营行动中心 · 派单核查与下一周期改善复核'
                        : view === 'detail'
                          ? `${selected.id} · ${selected.name}`
                          : '长春无人零售经营驾驶舱与五区实景风险地图'}
              </h2>
            </div>

            <div className="toolbar-actions">
              <div className="view-switch">
                <button className={view === 'map' || view === 'detail' ? 'active' : ''} onClick={() => setView('map')}>
                  <MapPin size={14} />
                  驾驶舱&amp;地图
                </button>
                <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>
                  <Layers3 size={14} />
                  对标
                </button>
                <button className={view === 'regions' ? 'active' : ''} onClick={() => setView('regions')}>
                  <Target size={14} />
                  资源投放(ROI)
                </button>
                <button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>
                  <ClipboardCheck size={14} />
                  行动闭环
                </button>
                <button className={view === 'workbench' ? 'active' : ''} onClick={() => setView('workbench')}>
                  <Gauge size={14} />
                  检测台
                </button>
                <button className={view === 'agent-loop' ? 'active' : ''} onClick={() => setView('agent-loop')}>
                  <Activity size={14} />
                  Agent Loop
                </button>
              </div>
              <button className="outline-button" onClick={() => openStoreCase(selected)}>
                <ClipboardCheck size={15} />
                案件抽屉 <span className="button-badge">{openTaskCount}</span>
              </button>
            </div>
          </div>

          {view !== 'workbench' && view !== 'agent-loop' && (
            <>
              {/* 顶部高密度经营驾驶舱核心指标条（含 6 周 SVG Sparkline 微型趋势线） */}
              <div className="exec-kpi-strip">
                <div className="exec-kpi-card">
                  <div className="exec-kpi-top">
                    <div>
                      <span className="exec-kpi-label">近 7 天总销售额 (GMV)</span>
                      <strong>¥{(dashboard.totalSales || 1001220).toLocaleString()}</strong>
                    </div>
                    <KpiSparkline points={[962000, 985000, 1012000, 1034000, 1048000, dashboard.totalSales || 1001220]} color="#1e6b52" />
                  </div>
                  <div className="exec-kpi-foot">
                    <span className="kpi-pill ok">毛利 ¥{(dashboard.estimatedProfit || 320390).toLocaleString()} (32%)</span>
                    <small>全城 21 家 CSV 门店周销 ¥5.14M</small>
                  </div>
                </div>

                <div className="exec-kpi-card">
                  <div className="exec-kpi-top">
                    <div>
                      <span className="exec-kpi-label">无人零售终端在线率</span>
                      <strong>
                        {dashboard.onlineRate ?? 95.2}%{' '}
                        <em className="exec-kpi-sub">
                          ({dashboard.activeDevices ?? 40}/{dashboard.totalDevices ?? 42} 台)
                        </em>
                      </strong>
                    </div>
                    <KpiSparkline points={[98.2, 97.6, 97.9, 96.8, 96.1, dashboard.onlineRate ?? 95.2]} color="#bd7b13" />
                  </div>
                  <div className="exec-kpi-foot">
                    <span className="kpi-pill warn">2 台硬件离线待巡检</span>
                    <small>南关店冰柜、绿园店结算台告警</small>
                  </div>
                </div>

                <div className="exec-kpi-card">
                  <div className="exec-kpi-top">
                    <div>
                      <span className="exec-kpi-label">云值守防损盘点差异</span>
                      <strong className="negative-text">
                        ¥{Math.abs(dashboard.totalInventoryDiffAmount || 2100).toLocaleString()} 损耗告警
                      </strong>
                    </div>
                    <KpiSparkline points={[620, 740, 810, 950, 1180, Math.abs(dashboard.totalInventoryDiffAmount || 2100)]} color="#c74743" />
                  </div>
                  <div className="exec-kpi-foot">
                    <span className="kpi-pill err">朝阳店占 -¥1,200</span>
                    <small>已联动云值守夜间视觉防损日志</small>
                  </div>
                </div>

                <div className="exec-kpi-card">
                  <div className="exec-kpi-top">
                    <div>
                      <span className="exec-kpi-label">规则引擎审计与行动闭环</span>
                      <strong>
                        {openTaskCount} 项待闭环 <em className="exec-kpi-sub">/ 26 店全覆盖</em>
                      </strong>
                    </div>
                    <KpiSparkline points={[6, 5, 4, 3, 2, openTaskCount || 1]} color="#2563eb" />
                  </div>
                  <div className="exec-kpi-foot">
                    <span className="kpi-pill info">store_anomaly_v1</span>
                    <small>2 店疑似异常 · 2 店缺失阻断保护</small>
                  </div>
                </div>
              </div>

              {/* 自然语言 AI 诊断与问数快捷栏（直连 POST /api/v1/agent/run） */}
              <div className="ai-quick-bar">
                <div className="ai-quick-top">
                  <div className="ai-quick-brand">
                    <span className="wb-badge ok">AGENT / 经营智能顾问</span>
                    <strong>自由提问 · 经营归因与投放决策工作台</strong>
                  </div>
                  <div className="ai-quick-chips">
                    {QUICK_PROMPTS.map((item) => (
                      <button
                        key={item.label}
                        className="ai-chip"
                        onClick={() => runQuickAgent(item.query)}
                        disabled={agentLoading}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ai-quick-input-row">
                  <input
                    className="ai-quick-input"
                    placeholder="自由输入任何经营问题（如：为什么朝阳店最近销售额下滑？如果去长春开新店选哪个区？对比 S001 和 S004）"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runQuickAgent()}
                  />
                  <button className="primary-button" onClick={() => runQuickAgent()} disabled={agentLoading}>
                    {agentLoading ? '思考与分析中...' : '发送提问'}
                  </button>
                  {agentResult && !agentLoading && (
                    <button className="secondary-button" onClick={() => setAgentResult(null)}>
                      收起结论面板
                    </button>
                  )}
                </div>

                {agentLoading && (
                  <div className="ai-quick-structured-wrap">
                    <AgentLiveThinkingState query={agentInput} />
                  </div>
                )}

                {agentResult && !agentLoading && (
                  <div className="ai-quick-structured-wrap">
                    <AgentStructuredOutput
                      response={agentResult}
                      compact={false}
                      actionBusy={actionBusy}
                      onApproveDecision={handleApproveDecisionProposal}
                      onNavigateTasks={() => setView('tasks')}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'agent-loop' ? (
            <AgentLoopPanel />
          ) : view === 'workbench' ? (
            <AgentWorkbench />
          ) : view === 'regions' ? (
            <RegionsView
              regions={regions}
              stores={stores}
              onAskRegion={(q) => runQuickAgent(q)}
              onSelectDistrictOnMap={(rId) => {
                setSelectedDistrict(rId)
                setView('map')
              }}
            />
          ) : view === 'tasks' ? (
            <TasksView
              tasks={tasks}
              activeTask={activeTask}
              onSelectTask={(tid) => setActiveTaskId(tid)}
              onAction={triggerTaskAction}
              busy={actionBusy}
            />
          ) : view === 'compare' ? (
            <CompareView
              stores={compareStores.length >= 2 ? compareStores : stores.slice(0, 8)}
              onClose={() => setView('map')}
              onGenerateCase={() => openStoreCase(selected)}
            />
          ) : view === 'detail' ? (
            <DetailView
              store={selected}
              projected={projected}
              targetGap={targetGap}
              peerMedian={peerMedian}
              onBack={() => setView('map')}
              onOpenCase={() => openStoreCase(selected)}
            />
          ) : (
            <>
              <div className="map-stage">
                <MapContainer
                  center={[43.88, 125.32]}
                  zoom={11.5}
                  zoomControl={false}
                  scrollWheelZoom={true}
                  className={`leaflet-map tile-mode-${mapTileMode}`}
                >
                  {mapTileMode === 'amap_road' && (
                    <TileLayer
                      key="amap_road"
                      attribution="&copy; 高德地图 AutoNavi 实景电子路网"
                      url="https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
                    />
                  )}
                  {mapTileMode === 'amap_sat' && (
                    <>
                      <TileLayer
                        key="amap_sat_base"
                        attribution="&copy; 高德地图 AutoNavi 卫星实景影像"
                        url="https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}"
                      />
                      <TileLayer
                        key="amap_sat_label"
                        url="https://webst01.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}"
                        opacity={0.85}
                      />
                    </>
                  )}
                  {mapTileMode === 'osm' && (
                    <TileLayer
                      key="osm"
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                  )}

                  {/* 长春市五区行政边界 Polygon 划分图层 */}
                  <GeoJSON
                    key={`geojson-${selectedDistrict}-${ mapTileMode}`}
                    data={changchunGeo}
                    style={(feature) => {
                      const dName = feature?.properties?.name || ''
                      const rId = NAME_TO_REGION_ID[dName] || 'chaoyang'
                      const dMeta = DISTRICT_META[rId] || DISTRICT_META.chaoyang
                      const isFocused = selectedDistrict === rId
                      const isDimmed = selectedDistrict !== 'all' && !isFocused
                      return {
                        color: dMeta.color,
                        weight: isFocused ? 3.2 : 2,
                        dashArray: isFocused ? '' : '5 4',
                        fillColor: dMeta.color,
                        fillOpacity: isFocused ? 0.22 : isDimmed ? 0.04 : 0.12,
                      }
                    }}
                    onEachFeature={(feature, layer) => {
                      const dName = feature?.properties?.name || ''
                      const rId = NAME_TO_REGION_ID[dName] || 'chaoyang'
                      const regObj = regions.find((r) => r.regionId === rId)
                      const distStores = stores.filter((s) => s.regionId === rId)
                      layer.bindTooltip(
                        `<strong>${dName}</strong> · ${distStores.length}家门店<br/>选址评分：${regObj?.score ?? '—'} | 回本周期：${regObj?.estimatedPaybackMonths ? `${regObj.estimatedPaybackMonths}个月` : '数据缺失(null)'}`,
                        { sticky: true, direction: 'top' }
                      )
                      layer.on({
                        click: () => {
                          setSelectedDistrict((prev) => (prev === rId ? 'all' : rId))
                        },
                      })
                    }}
                  />

                  {/* 同区可比门店对标连接虚线 */}
                  {sameDistrictPeersForLines.map((peer) => (
                    <Polyline
                      key={`line-${selected.id}-${peer.id}`}
                      positions={[
                        [selected.lat, selected.lng],
                        [peer.lat, peer.lng],
                      ]}
                      pathOptions={{
                        color: DISTRICT_META[selected.regionId]?.color || '#1e6b52',
                        weight: 1.6,
                        dashArray: '4 6',
                        opacity: 0.65,
                      }}
                    />
                  ))}

                  <MapViewport
                    selectedId={selectedId}
                    selectedDistrict={selectedDistrict === 'all' ? null : selectedDistrict}
                    stores={stores}
                  />

                  {mapVisibleStores.map((store) => {
                    const rMeta = riskMeta[store.risk] || riskMeta.normal
                    const isSel = store.id === selected.id
                    return (
                      <CircleMarker
                        key={store.id}
                        center={[store.lat, store.lng]}
                        radius={isSel ? 13 : store.dataSource === 'contract' ? 10 : 8}
                        pathOptions={{
                          color: isSel ? '#101a2d' : store.openCase ? '#fff7f0' : '#ffffff',
                          weight: isSel ? 3.5 : store.openCase ? 3.5 : 2,
                          fillColor: rMeta.color,
                          fillOpacity: 0.95,
                        }}
                        eventHandlers={{
                          click: (event) => {
                            if (event.originalEvent?.metaKey || event.originalEvent?.ctrlKey) {
                              toggleCompare(store.id)
                            } else {
                              selectStore(store.id, false)
                            }
                          },
                          dblclick: () => selectStore(store.id, true),
                        }}
                      >
                        <Popup>
                          <strong>
                            {store.id} · {store.name}
                          </strong>{' '}
                          <span className="wb-mono">({store.district})</span>
                          <br />
                          {store.risk === 'unavailable' ? (
                            <span>数据缺失不可判断（触发防编造保护）</span>
                          ) : (
                            <>
                              近7天销售额：¥{store.sales?.toLocaleString()} ({store.salesGap > 0 ? '+' : ''}
                              {store.salesGap}%)
                              <br />
                              退款率：{store.refundRate}% · 终端在线：{store.onlineDeviceCount}/{store.deviceCount} 台
                            </>
                          )}
                          <br />
                          <small>单击锁定下方驾驶舱图表 · 双击进入单店详情 · ⌘/Ctrl 多选对标</small>
                        </Popup>
                      </CircleMarker>
                    )
                  })}
                </MapContainer>

                <div className="map-overlay top-left">
                  <span className="map-kicker">
                    <span className="live-dot" /> LIVE / CHANGCHUN 5-DISTRICT REAL ATLAS
                  </span>
                  <strong>长春市实景五区划分与无人零售监测网</strong>
                  <small>已叠加五区行政多边形边界 · 点击区域筛选 · 单击门店联动下方趋势图</small>
                  <div className="map-district-filter-bar">
                    <button
                      className={selectedDistrict === 'all' ? 'active' : ''}
                      onClick={() => setSelectedDistrict('all')}
                    >
                      全城五区 ({stores.length})
                    </button>
                    {Object.entries(DISTRICT_META).map(([rId, meta]) => {
                      const count = stores.filter((s) => s.regionId === rId).length
                      return (
                        <button
                          key={rId}
                          className={selectedDistrict === rId ? 'active' : ''}
                          onClick={() => setSelectedDistrict(selectedDistrict === rId ? 'all' : rId)}
                        >
                          <i style={{ background: meta.color }} />
                          {meta.name} ({count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 右上角实景底图切换器 */}
                <div className="map-overlay top-right-switcher">
                  <div className="map-tile-switcher">
                    <button
                      className={mapTileMode === 'amap_road' ? 'active' : ''}
                      onClick={() => setMapTileMode('amap_road')}
                    >
                      高德实景路网
                    </button>
                    <button
                      className={mapTileMode === 'amap_sat' ? 'active' : ''}
                      onClick={() => setMapTileMode('amap_sat')}
                    >
                      卫星实景航拍
                    </button>
                    <button
                      className={mapTileMode === 'osm' ? 'active' : ''}
                      onClick={() => setMapTileMode('osm')}
                    >
                      标准街景
                    </button>
                  </div>
                </div>

                <div className="map-overlay map-legend">
                  <div className="legend-title">风险状态与五区资源导引</div>
                  {Object.entries(riskMeta).map(([key, item]) => (
                    <div className="legend-item" key={key}>
                      <span className="legend-dot" style={{ background: item.color }} />
                      {item.label}
                    </div>
                  ))}
                  <div className="legend-divider" />
                  <div className="legend-note">
                    <span className="ring-sample" /> 虚线连线 = 同区可比门店对标组
                  </div>
                </div>

                <div className="map-overlay map-stats">
                  <div>
                    <strong>{mapVisibleStores.length}</strong>
                    <span>当前视野门店</span>
                  </div>
                  <div>
                    <strong>{openTaskCount}</strong>
                    <span>待闭环案件</span>
                  </div>
                  <div>
                    <strong>
                      {comparableStores.length} / {stores.length}
                    </strong>
                    <span>数据完备可比</span>
                  </div>
                </div>
              </div>

              <div className="below-map">
                <div className="insight-bar">
                  <div className="insight-icon">
                    <AlertTriangle size={17} />
                  </div>
                  <div>
                    <strong>
                      当前锁定诊断 · {selected.id} {selected.name}（{selected.district} ·{' '}
                      {selected.dataSource === 'csv_datalayer' ? 'CSV 42天实测店' : '云值守标杆店'}）
                    </strong>
                    <span>
                      {selected.risk === 'unavailable' ? (
                        <>
                          该门店近 7 天核心退款流水字段为空，已触发 <b>store_anomaly_v1 数据缺失熔断保护</b>
                          ，严禁编造下滑原因或派发常规业务核查单。
                        </>
                      ) : (
                        <>
                          近 7 天销售额 <b>¥{selected.sales?.toLocaleString()}</b>（较前7天{' '}
                          <b>
                            {selected.salesGap > 0 ? '+' : ''}
                            {selected.salesGap}%
                          </b>
                          ），退款率 <b>{selected.refundRate}%</b>（同行中位数 <b>{selected.peerRefund}%</b>），订单贡献{' '}
                          <b>
                            {selected.ordersContribution > 0 ? '+' : ''}
                            {selected.ordersContribution}%
                          </b>
                          。
                        </>
                      )}
                    </span>
                  </div>
                  <button onClick={() => selectStore(selected.id, true)}>
                    进入单店显微镜 <ChevronRight size={15} />
                  </button>
                </div>

                {/* 新增：高密度经营驾驶舱核心图表双栏（左：42天双轨面积趋势图+双因子拆解；右：三态规则命中矩阵+五区资源投向沙盘） */}
                <div className="cockpit-bento-grid">
                  <div className="cockpit-card">
                    <div className="cockpit-card-head">
                      <div>
                        <span className="eyebrow">42-DAY (6-WEEK) DUAL-TRACK TREND &amp; DECOMPOSITION</span>
                        <h4>
                          {selected.id} · {selected.name} — 6 周销售额趋势与双因子归因拆解
                        </h4>
                      </div>
                      <div className="cockpit-store-pills">
                        {['A', 'S001', 'S004', 'S005', 'B', 'S002'].map((sid) => (
                          <button
                            key={sid}
                            className={selected.id === sid ? 'active' : ''}
                            onClick={() => selectStore(sid, false)}
                          >
                            {sid}
                          </button>
                        ))}
                      </div>
                    </div>

                    <StoreTrendChart store={selected} compact={true} />

                    {selected.risk !== 'unavailable' ? (
                      <div className="cockpit-decomp-strip">
                        <div className="cockpit-decomp-item">
                          <span>订单数变化贡献</span>
                          <div className="bar-track">
                            <span
                              className={(selected.ordersContribution ?? -78) < 0 ? 'bar-negative' : 'bar-positive'}
                              style={{ width: `${Math.min(Math.abs(selected.ordersContribution ?? -78), 100)}%` }}
                            />
                          </div>
                          <strong className={(selected.ordersContribution ?? -78) < 0 ? 'negative-text' : 'positive-text'}>
                            {(selected.ordersContribution ?? -78) > 0 ? '+' : ''}
                            {selected.ordersContribution ?? -78}%
                          </strong>
                        </div>
                        <div className="cockpit-decomp-item">
                          <span>客单价变化贡献</span>
                          <div className="bar-track">
                            <span
                              className={(selected.aovContribution ?? 16) < 0 ? 'bar-negative' : 'bar-positive'}
                              style={{ width: `${Math.min(Math.abs(selected.aovContribution ?? 16), 100)}%` }}
                            />
                          </div>
                          <strong className={(selected.aovContribution ?? 16) < 0 ? 'negative-text' : 'positive-text'}>
                            {(selected.aovContribution ?? 16) > 0 ? '+' : ''}
                            {selected.aovContribution ?? 16}%
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="cockpit-unavail-banner">
                        <Lock size={14} /> W6 (10.06—10.12) 核心退款字段为空，已自动拦截双因子拆解与趋势外推。
                      </div>
                    )}
                  </div>

                  <div className="cockpit-card">
                    <div className="cockpit-card-head">
                      <div>
                        <span className="eyebrow">RULE ENGINE &amp; RESOURCE ALLOCATION GUIDE</span>
                        <h4>规则共振矩阵与长春五区资源投向指引（资源应该投向哪里）</h4>
                      </div>
                      <button className="back-link" onClick={() => setView('regions')}>
                        展开完整漏斗 <ChevronRight size={14} />
                      </button>
                    </div>

                    <RuleMatrixCard store={selected} />

                    <div className="cockpit-resource-mini">
                      <div className="subsection-label">长春五区资源调配优先级（增量开店资金 vs 存量防损人力）</div>
                      <div className="cockpit-resource-table">
                        {regions.map((reg) => {
                          const isNull = reg.estimatedPaybackMonths === null
                          return (
                            <div
                              key={reg.regionId}
                              className={`cockpit-resource-row ${selected.regionId === reg.regionId ? 'active' : ''}`}
                              onClick={() => setSelectedDistrict(reg.regionId)}
                            >
                              <span className="res-district">
                                <i style={{ background: DISTRICT_META[reg.regionId]?.color || '#1e6b52' }} />
                                <strong>{reg.regionName}</strong>
                                <small>{reg.storeRadiusCount || 4}店</small>
                              </span>
                              <span className="res-score">评分 {reg.score.toFixed(1)}</span>
                              <span className={`res-payback ${isNull ? 'negative-text' : 'positive-text'}`}>
                                {isNull ? '回本 null (缺失)' : `${reg.estimatedPaybackMonths}月回本`}
                              </span>
                              <span className={`wb-badge ${isNull ? 'err' : reg.score >= 80 ? 'ok' : 'info'}`}>
                                {reg.resourceTrackLabel || '存量巡检'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="quick-panels">
                  <div className="quick-panel">
                    <div className="panel-heading">
                      <span>全城 26 店风险分布</span>
                      <span className="muted-label">5 标杆 + 21 CSV 实测</span>
                    </div>
                    <div className="risk-summary">
                      <div>
                        <strong className="red">{stores.filter((s) => s.risk === 'possible').length}</strong>
                        <span>可能异常</span>
                      </div>
                      <div>
                        <strong className="amber">{stores.filter((s) => s.risk === 'watch').length}</strong>
                        <span>需要关注</span>
                      </div>
                      <div>
                        <strong className="green">{stores.filter((s) => s.risk === 'normal').length}</strong>
                        <span>运行正常</span>
                      </div>
                      <div>
                        <strong style={{ color: '#64748b' }}>
                          {stores.filter((s) => s.risk === 'unavailable').length}
                        </strong>
                        <span>数据缺失保护</span>
                      </div>
                    </div>
                  </div>

                  <div className="quick-panel">
                    <div className="panel-heading">
                      <span>同区可比基准 ({selected.district})</span>
                      <span className="muted-label">同业态周度中位数</span>
                    </div>
                    <div className="benchmark-mini">
                      <div>
                        <span>周销售额中位数</span>
                        <strong>¥{peerMedian.toLocaleString()}</strong>
                        <em className="delta positive">同区基线</em>
                      </div>
                      <div>
                        <span>退款率中位数</span>
                        <strong>{selected.peerRefund ?? 2.1}%</strong>
                        <em className="delta negative">
                          {selected.id}店{' '}
                          {selected.refundRate !== null
                            ? `${selected.refundRate - (selected.peerRefund ?? 2.1) > 0 ? '+' : ''}${(selected.refundRate - (selected.peerRefund ?? 2.1)).toFixed(1)}pp`
                            : '缺失'}
                        </em>
                      </div>
                      <div>
                        <span>云值守设备在线率</span>
                        <strong>{dashboard.onlineRate ?? 95.2}%</strong>
                        <em className="delta neutral">40/42 台在线</em>
                      </div>
                    </div>
                  </div>

                  <div className="quick-panel">
                    <div className="panel-heading">
                      <span>选址与行动闭环直达</span>
                      <span className="muted-label">核心业务动作</span>
                    </div>
                    <div className="quick-action-links">
                      <button className="secondary-button" onClick={() => setView('regions')}>
                        <Target size={14} /> 朝阳区选址评分 86.5（增量资金首选）
                      </button>
                      <button className="secondary-button" onClick={() => setView('tasks')}>
                        <ClipboardCheck size={14} /> 推进 A/S001 店退款核查与复核关单
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* 全局右下角可缩放 Agent 对话浮窗（支持最小化胶囊 / 标准小窗 / 宽屏展开三态切换） */}
      <FloatingAgentCopilot
        size={copilotSize}
        onChangeSize={setCopilotSize}
        selectedStore={selected}
        messages={copilotMessages}
        loading={agentLoading}
        actionBusy={actionBusy}
        onSend={(q) => runQuickAgent(q, true)}
        onApproveDecision={handleApproveDecisionProposal}
        onNavigateTasks={() => setView('tasks')}
      />

      {caseOpen && (
        <CaseDrawer
          store={selected}
          task={activeTask}
          onClose={() => setCaseOpen(false)}
          onAction={triggerTaskAction}
          busy={actionBusy}
        />
      )}
    </div>
  )
}

function CompareView({ stores: compare, onClose, onGenerateCase }) {
  const validCompare = compare.filter((s) => s.risk !== 'unavailable' && s.sales !== null)
  const best =
    validCompare.length > 0
      ? validCompare.reduce((winner, item) => (item.salesGap > winner.salesGap ? item : winner), validCompare[0])
      : compare[0]

  return (
    <div className="content-view compare-view">
      <div className="view-header">
        <div>
          <span className="eyebrow">BENCHMARK / PEER GROUP COMPARISON</span>
          <h3>{compare.length} 家门店 · 同区域横向与防损对标</h3>
          <p>基准：长春市可比门店中位数 · 观察窗口：10.06 — 10.12（含云值守终端在线率与盘点差异）</p>
        </div>
        <button className="close-view" onClick={onClose}>
          <X size={16} />
          返回地图
        </button>
      </div>

      {best && (
        <div className="compare-callout">
          <div className="callout-icon">
            <Target size={18} />
          </div>
          <div>
            <strong>
              {best.id} · {best.name} 当前经营与防损表现最佳
            </strong>
            <span>
              销售额较前周期 <b>+{best.salesGap}%</b>，退款率仅 <b>{best.refundRate}%</b>（低于同类中位数{' '}
              {best.peerRefund}%），终端在线率 <b>{best.onlineRate ?? 100}%</b>，可作为同城云值守标准对标样本。
            </span>
          </div>
        </div>
      )}

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>门店</th>
              <th>销售额</th>
              <th>较前周期</th>
              <th>订单数</th>
              <th>客单价</th>
              <th>退款率</th>
              <th>设备在线率</th>
              <th>云值守盘点差异</th>
              <th>风险状态</th>
              <th>当前建议动作</th>
            </tr>
          </thead>
          <tbody>
            {compare.map((store) => {
              const rMeta = riskMeta[store.risk] || riskMeta.normal
              const isUnavail = store.risk === 'unavailable'
              return (
                <tr key={store.id} className={store.risk === 'possible' ? 'highlight-row' : ''}>
                  <td>
                    <div className="table-store">
                      <span className="mini-status" style={{ background: rMeta.color }} />
                      <div>
                        <strong>
                          {store.id} · {store.name}
                        </strong>
                        <small>{store.district}</small>
                      </div>
                    </div>
                  </td>
                  <td className="number">{isUnavail ? '数据缺失' : `¥${store.sales.toLocaleString()}`}</td>
                  <td className={isUnavail ? 'number' : store.salesGap < 0 ? 'negative-text' : 'positive-text'}>
                    {isUnavail ? '—' : `${store.salesGap > 0 ? '+' : ''}${store.salesGap}%`}
                  </td>
                  <td className="number">{isUnavail ? '—' : store.orders.toLocaleString()}</td>
                  <td className="number">{isUnavail ? '—' : `¥${store.aov}`}</td>
                  <td
                    className={
                      isUnavail
                        ? 'number'
                        : store.refundRate > store.peerRefund
                          ? 'negative-text'
                          : 'positive-text'
                    }
                  >
                    {isUnavail ? '—' : `${store.refundRate}%`}
                  </td>
                  <td className={(store.onlineRate ?? 100) < 95 ? 'negative-text' : 'positive-text'}>
                    {store.onlineDeviceCount ?? 8}/{store.deviceCount ?? 8} ({store.onlineRate ?? 100}%)
                  </td>
                  <td className={(store.inventoryDiffAmount ?? 0) < -500 ? 'negative-text' : 'number'}>
                    {store.inventoryDiffAmount === null || store.inventoryDiffAmount === undefined
                      ? '—'
                      : `¥${store.inventoryDiffAmount}`}
                  </td>
                  <td>
                    <span className="status-pill" style={{ color: rMeta.color, background: rMeta.soft }}>
                      {rMeta.label}
                    </span>
                  </td>
                  <td>
                    <span className="action-cell">{store.action}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="compare-foot">
        <div>
          <strong>横向对标结论</strong>
          <span>
            优先处置 A 朝阳旗舰店与 S001 朝阳1号店：销售额、退款率与云值守盘点差异同时偏离同城中位数；B
            南关生活店与 S005 店需优先恢复离线冰柜终端。
          </span>
        </div>
        <button className="primary-button" onClick={onGenerateCase}>
          打开案件抽屉并派单 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function DetailView({ store, projected, targetGap, peerMedian, onBack, onOpenCase }) {
  const meta = riskMeta[store.risk] || riskMeta.normal
  const isUnavailable = store.risk === 'unavailable'
  const ordContrib = store.ordersContribution ?? -78
  const aovContrib = store.aovContribution ?? 16

  return (
    <div className="content-view detail-view">
      <div className="view-header">
        <div>
          <button className="back-link" onClick={onBack}>
            <ChevronRight size={14} className="back-chevron" />
            返回风险地图与驾驶舱
          </button>
          <div className="detail-title-row">
            <span className="store-large-id">{store.id}</span>
            <div>
              <h3>{store.name}</h3>
              <p>
                {store.district} · {store.address} ·{' '}
                <span className="demo-tag">
                  {store.dataSource === 'csv_datalayer' ? '成员 B · CSV 42天规则实测门店' : '长春云值守标杆网点'}
                </span>
              </p>
            </div>
            <span className="status-pill large" style={{ color: meta.color, background: meta.soft }}>
              {meta.label}
            </span>
          </div>
        </div>
        <button className="outline-button" onClick={onOpenCase}>
          <ClipboardCheck size={15} />
          打开案件与派单抽屉
        </button>
      </div>

      {isUnavailable && (
        <div className="unavailable-guard-card">
          <div className="unavailable-header">
            <ShieldAlert size={22} />
            <div>
              <h4>数据缺失保护已触发（verdict = unavailable）</h4>
              <p>
                {store.verdictReason ||
                  '该门店缺少近 7 天核心退款流水或基线销量数据。根据系统防幻觉铁律，严禁编造经营下滑原因或生成趋势外推。'}
              </p>
            </div>
          </div>
          <div className="unavailable-rules">
            <div>
              <strong>受保护规则</strong>
              <span>store_anomaly_v1 · 缺核心指标时自动阻断异常归因</span>
            </div>
            <div>
              <strong>硬件在线状态</strong>
              <span>
                {store.onlineDeviceCount}/{store.deviceCount} 台在线（边缘网关日志同步中断）
              </span>
            </div>
            <div>
              <strong>标准处置动作</strong>
              <span>交由数据工程组修复边缘网关流水上报后重新执行审计</span>
            </div>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <section className="detail-card performance-card">
          <div className="card-top">
            <div>
              <span className="eyebrow">PERFORMANCE &amp; CLOUD GUARD / 7D</span>
              <h4>经营指标与云值守防损拆解</h4>
            </div>
            <span className="data-note">vs. 前 7 天 &amp; 同区中位数</span>
          </div>

          {!isUnavailable ? (
            <>
              <div className="detail-metrics">
                <Metric
                  label="销售额"
                  value={`¥${store.sales.toLocaleString()}`}
                  delta={store.salesGap}
                  tone={store.salesGap < 0 ? 'negative' : 'positive'}
                />
                <Metric
                  label="订单数"
                  value={store.orders.toLocaleString()}
                  delta={store.ordersGap}
                  tone={store.ordersGap < 0 ? 'negative' : 'positive'}
                />
                <Metric
                  label="客单价"
                  value={`¥${store.aov}`}
                  delta={store.aovGap}
                  tone={store.aovGap < 0 ? 'negative' : 'positive'}
                />
                <Metric
                  label="退款率"
                  value={store.refundRate}
                  suffix="%"
                  delta={Number((store.refundRate - store.peerRefund).toFixed(1))}
                  tone={store.refundRate > store.peerRefund ? 'negative' : 'positive'}
                />
              </div>

              <div className="cloud-guard-strip">
                <div>
                  <span>无人零售终端在线率</span>
                  <strong className={(store.onlineRate ?? 100) < 95 ? 'negative-text' : 'positive-text'}>
                    {store.onlineDeviceCount ?? 10} / {store.deviceCount ?? 10} 台 ({store.onlineRate ?? 100}%)
                  </strong>
                </div>
                <div>
                  <span>云值守货柜盘点差异</span>
                  <strong className={(store.inventoryDiffAmount ?? 0) < -500 ? 'negative-text' : ''}>
                    ¥{store.inventoryDiffAmount ?? 0}
                  </strong>
                </div>
                <div>
                  <span>近 7 天异常退款笔数</span>
                  <strong>{store.refundOrderCount ?? 0} 笔</strong>
                </div>
              </div>

              <div className="decomposition">
                <div className="subsection-label">确定性销售额变化拆解（订单数贡献 vs 客单价贡献）</div>
                <div className="decomp-row">
                  <span>订单数贡献</span>
                  <div className="bar-track">
                    <span
                      className={ordContrib < 0 ? 'bar-negative' : 'bar-positive'}
                      style={{ width: `${Math.min(Math.abs(ordContrib), 100)}%` }}
                    />
                  </div>
                  <strong>
                    {ordContrib > 0 ? '+' : ''}
                    {ordContrib}%
                  </strong>
                </div>
                <div className="decomp-row">
                  <span>客单价贡献</span>
                  <div className="bar-track">
                    <span
                      className={aovContrib < 0 ? 'bar-negative' : 'bar-positive'}
                      style={{ width: `${Math.min(Math.abs(aovContrib), 100)}%` }}
                    />
                  </div>
                  <strong>
                    {aovContrib > 0 ? '+' : ''}
                    {aovContrib}%
                  </strong>
                </div>
                <div className="decomp-caption">
                  {ordContrib < -50
                    ? '确定性拆解结论：订单数萎缩是销售额下滑的主因，客单价并未下跌。'
                    : '确定性拆解结论：订单数与客单价共同驱动当前销售额变化。'}
                </div>
              </div>
            </>
          ) : (
            <div className="cockpit-unavail-banner" style={{ marginTop: 12 }}>
              <Lock size={15} /> W6 核心退款字段缺失，当前仅保留 W1—W5 历史流水回溯，禁止输出当期环比归因。
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <RuleMatrixCard store={store} />
          </div>
        </section>

        <section className="detail-card outlook-card">
          <div className="card-top">
            <div>
              <span className="eyebrow">42-DAY TREND &amp; PEER CORRIDOR</span>
              <h4>6 周销售额走势与同区可比中位数走廊</h4>
            </div>
            <span className="projection-tag">42天真实序列 + 线性外推</span>
          </div>

          <StoreTrendChart store={store} compact={false} />

          {!isUnavailable && (
            <div className="projection-result">
              <div>
                <span>保持当前趋势 · 未来 7 天外推</span>
                <strong>¥{(projected ?? store.sales).toLocaleString()}</strong>
              </div>
              <div className={targetGap < 0 ? 'target-gap negative' : 'target-gap positive'}>
                {targetGap < 0 ? <ArrowDownRight size={17} /> : <ArrowUpRight size={17} />}
                <strong>
                  {targetGap < 0 ? '-' : '+'}¥{Math.abs(targetGap ?? 0).toLocaleString()}
                </strong>
                <span>与同区中位数差距</span>
              </div>
            </div>
          )}
          <p className="disclaimer">
            <CircleHelp size={13} />
            基于 42 天（W1—W6）周度聚合流水与近 7 天变化率线性外推，仅用于提示若不干预的缺口风险。
          </p>
        </section>

        <section className="detail-card action-card">
          <div className="card-top">
            <div>
              <span className="eyebrow">ACTION / CASE {store.caseId || '—'}</span>
              <h4>推荐经营行动与复核标准</h4>
            </div>
            <span
              className="status-pill"
              style={{
                color: store.openCase ? '#c74743' : '#258b68',
                background: store.openCase ? '#fde9e7' : '#e7f5ef',
              }}
            >
              {store.openCase ? `待闭环 (${store.taskStatus || 'open'})` : '无需业务派单'}
            </span>
          </div>
          <div className="action-main">
            <div className="action-priority">P{store.openCase ? 1 : 3}</div>
            <div>
              <strong>{store.action}</strong>
              <p>
                {isUnavailable ? (
                  '由于关键流水字段为空，系统已自动阻断业务整改工单生成，仅通知数据工程组核查边缘网关。'
                ) : (
                  <>
                    退款率较同城可比中位数偏离{' '}
                    <b>
                      {store.refundRate - store.peerRefund > 0 ? '+' : ''}
                      {(store.refundRate - store.peerRefund).toFixed(1)}pp
                    </b>
                    ，云值守盘点差异 <b>¥{store.inventoryDiffAmount}</b>。
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="action-meta">
            <span>
              <Users size={14} />
              负责人：{store.owner}
            </span>
            <span>
              <Activity size={14} />
              时限：{store.due}
            </span>
            <span>
              <ShieldAlert size={14} />
              审计追踪：{store.trace}
            </span>
          </div>
          <button className="primary-button full" onClick={onOpenCase}>
            {store.openCase ? '打开风险案件抽屉 · 执行派单与复核' : '查看门店经营与审计记录'}
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
    </div>
  )
}

function RegionsView({ regions, stores = [], onAskRegion, onSelectDistrictOnMap }) {
  const [selectedRegionId, setSelectedRegionId] = useState('chaoyang')
  const [scoreMode, setScoreMode] = useState('csv') // 'csv' (真实成本漏斗口径) | 'contract' (契约四维评分口径)
  const currentReg = regions.find((r) => r.regionId === selectedRegionId) || regions[0]
  const rawFunnel = currentReg?.resourceFunnel || {}
  const isCurrentNull =
    scoreMode === 'contract'
      ? currentReg?.estimatedPaybackMonths === null || currentReg?.estimatedPaybackMonths === undefined
      : currentReg?.csvPaybackMonths === null && currentReg?.estimatedPaybackMonths === null

  const funnel = {
    grossRevenue: rawFunnel.grossRevenue ?? rawFunnel.monthlyRevenueEst ?? 135000,
    grossMarginPct:
      rawFunnel.grossMarginPct ??
      (rawFunnel.grossMarginRatio ? Math.round(rawFunnel.grossMarginRatio * 100) : 30),
    grossProfit: rawFunnel.grossProfit ?? rawFunnel.grossProfitEst ?? 43200,
    rentCost: isCurrentNull ? null : (rawFunnel.rentCost ?? rawFunnel.monthlyRent ?? null),
    laborCost: isCurrentNull ? null : (rawFunnel.laborCost ?? rawFunnel.monthlyLabor ?? null),
    fixedCosts: isCurrentNull ? null : (rawFunnel.fixedCosts ?? rawFunnel.totalMonthlyCost ?? null),
    netCashflow: isCurrentNull ? null : (rawFunnel.netCashflow ?? currentReg?.csvMonthlyProfit ?? null),
  }

  return (
    <div className="content-view regions-view">
      <div className="region-formula-banner">
        <div>
          <span className="eyebrow">SPATIAL RESOURCE ALLOCATION &amp; ROI FUNNEL / REGION_SCORE_V1</span>
          <h4>长春市五区资源应该投向哪里？—— 单店现金流转化漏斗与双轨资源调配沙盘</h4>
          <p>
            同时支持 <code>CSV 真实成本与单店现金流漏斗 (region_cost_input.csv)</code> 与{' '}
            <code>契约四维加权模型 (Score = 0.45×需求 + 0.25×竞品 + 0.35×毛利 - 0.15×成本)</code>
            ；当区域缺失租金/人力/建店成本时强制熔断为 <code>null</code>。
          </p>
        </div>
        <div className="region-banner-actions">
          <div className="mode-toggle-pills">
            <button className={scoreMode === 'csv' ? 'active' : ''} onClick={() => setScoreMode('csv')}>
              CSV 真实成本漏斗口径
            </button>
            <button className={scoreMode === 'contract' ? 'active' : ''} onClick={() => setScoreMode('contract')}>
              契约四维评分口径
            </button>
          </div>
          <button
            className="outline-button"
            onClick={() => onAskRegion('长春哪个区最适合新开门店？南关区能算回本周期吗？')}
          >
            让 Agent 解读选址报告 <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* 核心新增模块：资源应该投向哪里？(左：单店月度现金流 4 阶转化漏斗；右：增量开店资金 vs 存量运维人力双轨调配矩阵) */}
      <div className="resource-funnel-panel">
        <div className="funnel-left-col">
          <div className="cockpit-card-head">
            <div>
              <span className="eyebrow">UNIT ECONOMICS 4-STAGE FUNNEL</span>
              <h4>{currentReg.regionName} · 单店月度现金流与回本周期 4 阶转化漏斗</h4>
            </div>
            <div className="cockpit-store-pills">
              {regions.map((r) => (
                <button
                  key={r.regionId}
                  className={selectedRegionId === r.regionId ? 'active' : ''}
                  onClick={() => setSelectedRegionId(r.regionId)}
                >
                  {r.regionName}
                </button>
              ))}
            </div>
          </div>

          <div className="funnel-stages">
            <div className="funnel-stage-row">
              <div className="funnel-stage-label">
                <span className="stage-num">01</span>
                <div>
                  <strong>区域同店月均总营收基线</strong>
                  <small>基于该区在营门店 42 天真实流水折算 (30天)</small>
                </div>
              </div>
              <div className="funnel-stage-bar-wrap">
                <div className="funnel-bar stage-1" style={{ width: '100%' }} />
              </div>
              <strong className="funnel-stage-val">¥{(funnel.grossRevenue || 135000).toLocaleString()}/月</strong>
            </div>

            <div className="funnel-stage-row">
              <div className="funnel-stage-label">
                <span className="stage-num">02</span>
                <div>
                  <strong>扣除商品成本后月毛利空间</strong>
                  <small>区域估算毛利率 {funnel.grossMarginPct ?? 32}%</small>
                </div>
              </div>
              <div className="funnel-stage-bar-wrap">
                <div
                  className="funnel-bar stage-2"
                  style={{ width: `${Math.min(Math.round(((funnel.grossProfit || 43000) / (funnel.grossRevenue || 135000)) * 100), 100)}%` }}
                />
              </div>
              <strong className="funnel-stage-val">¥{(funnel.grossProfit || 43200).toLocaleString()}/月</strong>
            </div>

            <div className="funnel-stage-row">
              <div className="funnel-stage-label">
                <span className="stage-num">03</span>
                <div>
                  <strong>减去月租金与运维人力硬成本</strong>
                  <small>
                    {funnel.rentCost !== null && funnel.rentCost !== undefined
                      ? `租金 ¥${funnel.rentCost.toLocaleString()} + 运维人力 ¥${funnel.laborCost.toLocaleString()}`
                      : '缺少完整租金与物业基线数据 · 触发防编造熔断'}
                  </small>
                </div>
              </div>
              <div className="funnel-stage-bar-wrap">
                {funnel.fixedCosts !== null && funnel.fixedCosts !== undefined ? (
                  <div
                    className="funnel-bar stage-3"
                    style={{ width: `${Math.min(Math.round((funnel.fixedCosts / (funnel.grossRevenue || 135000)) * 100), 100)}%` }}
                  />
                ) : (
                  <div className="funnel-bar stage-null">缺失成本基线 · 触发防编造熔断</div>
                )}
              </div>
              <strong className={`funnel-stage-val ${funnel.fixedCosts === null ? 'negative-text' : ''}`}>
                {funnel.fixedCosts !== null && funnel.fixedCosts !== undefined
                  ? `-¥${funnel.fixedCosts.toLocaleString()}/月`
                  : 'null (缺失)'}
              </strong>
            </div>

            <div className="funnel-stage-row highlight">
              <div className="funnel-stage-label">
                <span className="stage-num">04</span>
                <div>
                  <strong>单店月净现金流 &amp; 建店回本周期</strong>
                  <small>
                    CAPEX 建店投入：
                    {!isCurrentNull && (currentReg.capexInvestment || rawFunnel.totalCapexCsv)
                      ? `¥${(scoreMode === 'csv' && rawFunnel.totalCapexCsv ? rawFunnel.totalCapexCsv : currentReg.capexInvestment).toLocaleString()}`
                      : 'null (缺失)'}
                  </small>
                </div>
              </div>
              <div className="funnel-stage-bar-wrap">
                {funnel.netCashflow !== null && funnel.netCashflow !== undefined ? (
                  <div
                    className="funnel-bar stage-4"
                    style={{ width: `${Math.max(Math.min(Math.round((funnel.netCashflow / (funnel.grossRevenue || 135000)) * 100), 100), 8)}%` }}
                  />
                ) : (
                  <div className="funnel-bar stage-null">禁止输出回本周期</div>
                )}
              </div>
              <strong className={`funnel-stage-val ${isCurrentNull ? 'negative-text' : 'positive-text'}`}>
                {isCurrentNull
                  ? '回本 null'
                  : `+¥${(scoreMode === 'csv' ? currentReg.csvMonthlyProfit || funnel.netCashflow : currentReg.estimatedMonthlyProfit).toLocaleString()}/月 (${scoreMode === 'csv' ? currentReg.csvPaybackMonths ?? currentReg.estimatedPaybackMonths : currentReg.estimatedPaybackMonths}月)`}
              </strong>
            </div>
          </div>

          <div className="funnel-strategy-callout">
            <div>
              <span className="subsection-label">当前区域资源投放决策建议 ({currentReg.regionName})</span>
              <p>{currentReg.allocationStrategy || currentReg.rationale}</p>
            </div>
            {onSelectDistrictOnMap && (
              <button className="secondary-button" onClick={() => onSelectDistrictOnMap(currentReg.regionId)}>
                在实景地图定位该区 ({stores.filter((s) => s.regionId === currentReg.regionId).length}店)
              </button>
            )}
          </div>
        </div>

        <div className="funnel-right-col">
          <div className="cockpit-card-head">
            <div>
              <span className="eyebrow">DUAL-TRACK RESOURCE MATRIX</span>
              <h4>存量运维人力 vs 增量开店资金 · 资源投向总览</h4>
            </div>
          </div>

          <div className="dual-track-boxes">
            <div className="track-box capex-track">
              <div className="track-head">
                <span className="wb-badge ok">增量新店资金轨 (CAPEX 扩张)</span>
                <strong>优先投向：朝阳区 (A级) ➔ 二道区 (B级)</strong>
              </div>
              <p>
                朝阳区高毛利商圈成熟，CSV 实测单店月净现金流达 <b>¥17,677</b>（约 <b>11.2 个月</b>{' '}
                回本，契约口径 6.2 个月）；二道区居住密集且租金低廉（¥13k/月），适合加密社区生鲜冷柜。
              </p>
            </div>

            <div className="track-box opex-track">
              <div className="track-head">
                <span className="wb-badge warn">存量运维与防损轨 (OPEX 抢修)</span>
                <strong>优先投向：朝阳1号店(S001/A) ➔ 南关生活店(S005/B)</strong>
              </div>
              <p>
                朝阳旗舰店(A/S001) 命中 3 项异常规则且盘点差异 <b>-¥1,200</b>，需区域经理 24h 内抽查 20
                笔退款单；南关区与绿园区需优先恢复离线冷链冰柜与结算终端。
              </p>
            </div>

            <div className="track-box guard-track">
              <div className="track-head">
                <span className="wb-badge err">数据治理与补采轨 (熔断挂起)</span>
                <strong>强制挂起：南关区新店审批 &amp; S004/E店异常归因</strong>
              </div>
              <p>
                南关区缺失租金、人力与建店成本基线（<code>estimatedPaybackMonths = null</code>），S004
                缺失近 7 天退款流水（<code>verdict = unavailable</code>），系统已自动锁定审批，待补采后解锁。
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="region-cards-grid">
        {regions.map((reg, idx) => {
          const isNullPayback = reg.estimatedPaybackMonths === null || reg.estimatedPaybackMonths === undefined
          const displayScore = scoreMode === 'csv' && reg.csvScore ? reg.csvScore : reg.score
          const displayProfit =
            scoreMode === 'csv' && reg.csvMonthlyProfit !== undefined
              ? reg.csvMonthlyProfit
              : reg.estimatedMonthlyProfit
          const displayPayback =
            scoreMode === 'csv' && reg.csvPaybackMonths !== undefined
              ? reg.csvPaybackMonths
              : reg.estimatedPaybackMonths

          return (
            <div
              key={reg.regionId}
              className={`region-card ${selectedRegionId === reg.regionId ? 'top-pick' : ''} ${isNullPayback ? 'null-guard' : ''}`}
              onClick={() => setSelectedRegionId(reg.regionId)}
              style={{ cursor: 'pointer' }}
            >
              <div className="region-card-head">
                <div>
                  <span className="region-rank">
                    NO.{idx + 1} · {reg.grade || 'B'}级
                  </span>
                  <h4>{reg.regionName}</h4>
                </div>
                <div className="region-score-badge">
                  <strong>{Number(displayScore).toFixed(1)}</strong>
                  <span>{scoreMode === 'csv' ? 'CSV实测分' : '契约得分'}</span>
                </div>
              </div>

              <div className="region-decision-row">
                <span className={`wb-badge ${isNullPayback ? 'err' : idx === 0 ? 'ok' : 'info'}`}>
                  {reg.resourceTrackLabel || reg.decision || (isNullPayback ? '数据缺失·继续调研' : '推荐投放')}
                </span>
                <span className="wb-mono">在营 {reg.storeRadiusCount || 4} 店</span>
              </div>

              <div className="region-factors">
                <div>
                  <span>需求 (0.45)</span>
                  <strong>{reg.demandScore ?? '—'}</strong>
                </div>
                <div>
                  <span>竞品 (0.25)</span>
                  <strong>{reg.competitionScore ?? '—'}</strong>
                </div>
                <div>
                  <span>毛利 (0.35)</span>
                  <strong>{reg.marginScore ?? '—'}</strong>
                </div>
                <div>
                  <span>成本 (-0.15)</span>
                  <strong>{reg.costScore ?? '—'}</strong>
                </div>
              </div>

              <div className="region-roi-box">
                <div>
                  <span>单店月净现金流</span>
                  <strong>{displayProfit ? `¥${displayProfit.toLocaleString()}` : 'null (待补采)'}</strong>
                </div>
                <div>
                  <span>CAPEX 建店投入</span>
                  <strong>{reg.capexInvestment ? `¥${reg.capexInvestment.toLocaleString()}` : '缺失基线'}</strong>
                </div>
                <div>
                  <span>预计回本周期</span>
                  {isNullPayback ? (
                    <strong className="negative-text">null (禁止编造)</strong>
                  ) : (
                    <strong className="positive-text">{displayPayback} 个月</strong>
                  )}
                </div>
              </div>

              <p className="region-rationale">{reg.rationale}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TasksView({ tasks, activeTask, onSelectTask, onAction, busy }) {
  const steps = [
    { key: 'open', label: '1. 待人工确认 (open)' },
    { key: 'assigned', label: '2. 已指派负责人 (assigned)' },
    { key: 'investigating', label: '3. 现场/云值守核查 (investigating)' },
    { key: 'verifying', label: '4. 待下一周期复核 (verifying)' },
    { key: 'final', label: '5. 达标关闭 / 升级督办 (closed/escalated)' },
  ]
  const currentMeta = taskStatusMeta[activeTask?.status] || taskStatusMeta.open

  return (
    <div className="content-view tasks-view">
      <div className="view-header">
        <div>
          <span className="eyebrow">CLOSED-LOOP ACTION CENTER / HUMAN-IN-THE-LOOP</span>
          <h3>经营行动中心 · 人工确认派单与下一周期改善复核</h3>
          <p>遵循 PROJECT.md §2.5 铁律：发现异常 → 人工确认并补齐负责人/时限 → 核查执行 → 下一周期指标改善才允许关闭</p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => onAction('reset_demo', { taskId: activeTask?.taskId })}
        >
          重置演示任务状态机
        </button>
      </div>

      <div className="tasks-layout">
        <div className="tasks-list-col">
          {tasks.map((t) => {
            const sMeta = taskStatusMeta[t.status] || taskStatusMeta.open
            return (
              <button
                key={t.taskId}
                className={`task-list-card ${activeTask?.taskId === t.taskId ? 'active' : ''}`}
                onClick={() => onSelectTask(t.taskId)}
              >
                <div className="task-card-top">
                  <span className="wb-mono">{t.taskId}</span>
                  <span className="status-pill" style={{ color: sMeta.color, background: sMeta.soft }}>
                    {sMeta.label}
                  </span>
                </div>
                <strong>
                  {t.storeId} · {t.storeName}
                </strong>
                <p>{t.problem}</p>
                <div className="task-card-foot">
                  <span>{t.ownerRole}</span>
                  <span>限时 {t.dueLabel}</span>
                </div>
              </button>
            )
          })}
        </div>

        {activeTask && (
          <div className="task-detail-panel">
            <div className="task-stepper">
              {steps.map((s, idx) => (
                <div
                  key={s.key}
                  className={`step-node ${idx <= currentMeta.stepIndex ? 'done' : ''} ${idx === currentMeta.stepIndex ? 'current' : ''}`}
                >
                  <span className="step-num">{idx + 1}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            <div className="task-detail-head">
              <div>
                <span className="eyebrow">
                  TASK {activeTask.taskId} · TRACE {activeTask.traceId}
                </span>
                <h4>
                  {activeTask.storeId} · {activeTask.storeName} — {activeTask.action}
                </h4>
              </div>
              <span className="status-pill large" style={{ color: currentMeta.color, background: currentMeta.soft }}>
                {currentMeta.label}
              </span>
            </div>

            <div className="task-info-grid">
              <div>
                <span>异常问题摘要</span>
                <strong>{activeTask.problem}</strong>
              </div>
              <div>
                <span>执行角色与时限</span>
                <strong>
                  {activeTask.ownerRole} · {activeTask.dueLabel}
                </strong>
              </div>
              <div>
                <span>下一周期关单复核条件</span>
                <strong>{activeTask.verifyTarget}</strong>
              </div>
            </div>

            <div className="task-action-controls">
              <span className="subsection-label">推动状态机流转（真实调用 POST /api/v1/operations/task-action）</span>
              <div className="task-btn-row">
                <button
                  className="primary-button"
                  disabled={busy || activeTask.status !== 'open'}
                  onClick={() => onAction('confirm_assign', { taskId: activeTask.taskId })}
                >
                  1. 人工确认并派发任务
                </button>
                <button
                  className="outline-button"
                  disabled={busy || activeTask.status !== 'assigned'}
                  onClick={() => onAction('start_investigate', { taskId: activeTask.taskId })}
                >
                  2. 店长/经理接单核查
                </button>
                <button
                  className="outline-button"
                  disabled={busy || (activeTask.status !== 'investigating' && activeTask.status !== 'assigned')}
                  onClick={() => onAction('submit_evidence', { taskId: activeTask.taskId })}
                >
                  3. 提交20笔退款与云值守核查记录
                </button>
                <button
                  className="primary-button"
                  style={{ background: '#258b68' }}
                  disabled={busy || activeTask.status === 'closed'}
                  onClick={() => onAction('verify_improved', { taskId: activeTask.taskId })}
                >
                  4A. 下一周期复核：退款率回落至2.8% (关单)
                </button>
                <button
                  className="primary-button"
                  style={{ background: '#c74743' }}
                  disabled={busy}
                  onClick={() => onAction('verify_unresolved', { taskId: activeTask.taskId })}
                >
                  4B. 下一周期复核：退款率仍6.4% (升级督办)
                </button>
              </div>
            </div>

            {activeTask.verificationResult && (
              <div
                className={`task-verify-banner ${activeTask.status === 'closed' ? 'ok' : 'err'}`}
              >
                <strong>
                  下一周期复核结果（verifyTask: {activeTask.verificationResult.status}）：
                </strong>
                <p>{activeTask.verificationResult.summary}</p>
                <div className="task-verify-metrics">
                  <span>实测退款率：{activeTask.verificationResult.observedMetric}</span>
                  <span>同行中位数：{activeTask.verificationResult.peerMedian}</span>
                  <span>关单阈值：{activeTask.verificationResult.threshold}</span>
                </div>
              </div>
            )}

            <div className="task-history-box">
              <div className="subsection-label">任务流转与审计日志 (Audit Trail)</div>
              <div className="task-history-list">
                {(activeTask.history || []).map((h, i) => (
                  <div key={i} className="task-history-item">
                    <span className="wb-mono">{h.at}</span>
                    <span className="wb-badge info">{h.step}</span>
                    <span>{h.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CaseDrawer({ store, task, onClose, onAction, busy }) {
  const activeTask = task || FALLBACK_TASKS[0]
  const sMeta = taskStatusMeta[activeTask.status] || taskStatusMeta.open

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="case-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">
              CASE CENTER / {activeTask.sourceCaseId || store.caseId || 'STORE RECORD'}
            </span>
            <h3>
              {activeTask.storeId} · {activeTask.storeName}
            </h3>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-status">
          <span className="status-pill" style={{ color: sMeta.color, background: sMeta.soft }}>
            {activeTask.priority} · {sMeta.label}
          </span>
          <span>最近更新 {activeTask.updatedAt}</span>
        </div>

        <div className="case-section">
          <div className="subsection-label">案件摘要（绑定规则引擎证据）</div>
          <p>{activeTask.problem}</p>
        </div>

        <div className="case-section">
          <div className="subsection-label">已核查证据链 (Evidence IDs)</div>
          <div className="evidence-list">
            {(activeTask.evidenceDetails || []).map((ev) => (
              <div key={ev.id}>
                <span className="evidence-id">{ev.id}</span>
                <span>{ev.label}</span>
                <strong>{ev.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="case-section">
          <div className="subsection-label">结构化行动卡</div>
          <div className="case-action">
            <div className="action-priority">{activeTask.priority}</div>
            <div>
              <strong>{activeTask.action}</strong>
              <span>
                负责人：{activeTask.ownerRole} · 截止：{activeTask.dueLabel}
              </span>
            </div>
            <CheckCircle2 size={17} className="action-check" />
          </div>
        </div>

        <div className="case-section">
          <div className="subsection-label">下一周期复核条件 (Verification Gate)</div>
          <div className="verify-box">
            <Gauge size={17} />
            <span>{activeTask.verifyTarget}</span>
          </div>
        </div>

        {activeTask.verificationResult && (
          <div className="case-section">
            <div className="subsection-label">最新复核结论</div>
            <div className={`verify-box ${activeTask.status === 'escalated' ? 'escalated-box' : ''}`}>
              <span>{activeTask.verificationResult.summary}</span>
            </div>
          </div>
        )}

        <div className="drawer-footer-stack">
          {activeTask.status === 'open' && (
            <button
              className="primary-button full"
              disabled={busy}
              onClick={() => onAction('confirm_assign', { taskId: activeTask.taskId })}
            >
              人工确认并派发任务 (open → assigned) <ChevronRight size={16} />
            </button>
          )}
          {activeTask.status === 'assigned' && (
            <button
              className="primary-button full"
              disabled={busy}
              onClick={() => onAction('start_investigate', { taskId: activeTask.taskId })}
            >
              开始现场与云值守录像核查 (assigned → investigating) <ChevronRight size={16} />
            </button>
          )}
          {activeTask.status === 'investigating' && (
            <button
              className="primary-button full"
              disabled={busy}
              onClick={() => onAction('submit_evidence', { taskId: activeTask.taskId })}
            >
              提交 20 笔退款核查结论 (进入待复核 verifying) <ChevronRight size={16} />
            </button>
          )}
          <div className="drawer-verify-row">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => onAction('verify_improved', { taskId: activeTask.taskId })}
            >
              复核达标关单 (2.8%)
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => onAction('verify_unresolved', { taskId: activeTask.taskId })}
            >
              复核未过升级 (6.4%)
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/**
 * 全局右下角可缩放 Agent 对话浮窗（支持 minimized 最小化胶囊 / normal 标准小窗 / expanded 宽屏深度对话）
 */
function FloatingAgentCopilot({
  size = 'normal',
  onChangeSize,
  selectedStore,
  messages = [],
  loading = false,
  actionBusy = false,
  onSend,
  onApproveDecision,
  onNavigateTasks,
}) {
  const [draft, setDraft] = useState('')

  function handleSend() {
    const q = draft.trim()
    if (!q || loading) return
    setDraft('')
    onSend(q)
  }

  if (size === 'minimized') {
    return (
      <div className="floating-copilot-pill" onClick={() => onChangeSize('normal')}>
        <span className="live-dot" />
        <Bot size={17} />
        <div>
          <strong>莱森经营 Copilot</strong>
          <small>
            已锁定 {selectedStore?.id} · {selectedStore?.district}
          </small>
        </div>
        <span className="copilot-pill-badge">{messages.length}</span>
        <Maximize2 size={14} />
      </div>
    )
  }

  return (
    <aside className={`floating-copilot-window size-${size}`}>
      <header className="copilot-header">
        <div className="copilot-title">
          <div className="copilot-bot-icon">
            <Sparkles size={15} />
          </div>
          <div>
            <strong>莱森经营 Copilot · 随航决策顾问</strong>
            <span>
              当前上下文：{selectedStore?.id} {selectedStore?.name} ({selectedStore?.district})
            </span>
          </div>
        </div>
        <div className="copilot-window-controls">
          <button
            className="copilot-ctrl-btn"
            title={size === 'expanded' ? '恢复标准窗口' : '放大为宽屏决策视图'}
            onClick={() => onChangeSize(size === 'expanded' ? 'normal' : 'expanded')}
          >
            {size === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="copilot-ctrl-btn"
            title="最小化至右下角胶囊"
            onClick={() => onChangeSize('minimized')}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="copilot-quick-prompts">
        {QUICK_PROMPTS.slice(0, 4).map((p) => (
          <button key={p.label} disabled={loading} onClick={() => onSend(p.query)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="copilot-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`copilot-msg ${msg.role}`}>
            <div className="copilot-msg-meta">
              <strong>{msg.role === 'user' ? '运营总监 (You)' : '莱森经营智能顾问'}</strong>
              <span>{msg.at}</span>
            </div>
            {msg.role === 'user' ? (
              <p className="copilot-user-text">{msg.text}</p>
            ) : (
              <div className="copilot-assistant-body">
                <AgentStructuredOutput
                  response={msg}
                  compact={size !== 'expanded'}
                  actionBusy={actionBusy}
                  onApproveDecision={onApproveDecision}
                  onNavigateTasks={onNavigateTasks}
                />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="copilot-msg assistant">
            <div className="copilot-msg-meta">
              <strong>莱森经营智能顾问</strong>
              <span>正在分析...</span>
            </div>
            <AgentLiveThinkingState query={draft} compact={true} />
          </div>
        )}
      </div>

      <footer className="copilot-footer">
        <input
          placeholder={`自由输入经营问题（如：这家店为什么退款高？去哪个区开店回本最快？）`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button className="copilot-send-btn" onClick={handleSend} disabled={loading}>
          <Send size={14} />
        </button>
      </footer>
    </aside>
  )
}

createRoot(document.getElementById('root')).render(<App />)

