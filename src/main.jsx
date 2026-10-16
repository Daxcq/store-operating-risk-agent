import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, CheckCircle2, ChevronRight, CircleHelp, ClipboardCheck, Filter, Gauge, Layers3, MapPin, MoreHorizontal, Search, ShieldAlert, SlidersHorizontal, Target, Users, X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './styles.css'

const stores = [
  { id: 'A', name: '朝阳旗舰店', district: '朝阳区', address: '红旗街商圈', lat: 43.881, lng: 125.301, risk: 'possible', sales: 172000, salesGap: -28, orders: 2140, ordersGap: -31, aov: 80.4, aovGap: 4, refundRate: 7, peerRefund: 2.1, openCase: true, impact: 28000, action: '抽查最近 20 笔退款订单', owner: '区域经理', due: '24 小时内', caseId: 'case_A_001', trace: 'trace_20261018_A' },
  { id: 'B', name: '南关生活店', district: '南关区', address: '重庆路商圈', lat: 43.855, lng: 125.323, risk: 'watch', sales: 198000, salesGap: -9, orders: 2580, ordersGap: -7, aov: 76.7, aovGap: -2, refundRate: 3.4, peerRefund: 2.1, openCase: false, impact: 9000, action: '核对本周促销记录', owner: '店长', due: '48 小时内', caseId: null, trace: 'trace_20261018_B' },
  { id: 'C', name: '宽城北站店', district: '宽城区', address: '北站商圈', lat: 43.911, lng: 125.327, risk: 'normal', sales: 224000, salesGap: 6, orders: 2910, ordersGap: 4, aov: 77, aovGap: 2, refundRate: 1.8, peerRefund: 2.1, openCase: false, impact: 0, action: '保持当前经营节奏', owner: '店长', due: '无需处理', caseId: null, trace: 'trace_20261018_C' },
  { id: 'D', name: '二道东盛店', district: '二道区', address: '东盛大街商圈', lat: 43.871, lng: 125.385, risk: 'normal', sales: 211000, salesGap: 2, orders: 2730, ordersGap: 1, aov: 77.3, aovGap: 1, refundRate: 2.0, peerRefund: 2.1, openCase: false, impact: 0, action: '保持当前经营节奏', owner: '店长', due: '无需处理', caseId: null, trace: 'trace_20261018_D' },
  { id: 'E', name: '绿园吾悦店', district: '绿园区', address: '吾悦广场商圈', lat: 43.884, lng: 125.258, risk: 'watch', sales: 189000, salesGap: -12, orders: 2460, ordersGap: -14, aov: 76.8, aovGap: 2, refundRate: 2.7, peerRefund: 2.1, openCase: false, impact: 12000, action: '检查客流与营业时段', owner: '店长', due: '48 小时内', caseId: null, trace: 'trace_20261018_E' },
]

const riskMeta = {
  possible: { label: '可能异常', color: '#d24a44', soft: '#fde9e7' },
  watch: { label: '需要关注', color: '#bd7b13', soft: '#fff5df' },
  normal: { label: '运行正常', color: '#258b68', soft: '#e7f5ef' },
  unavailable: { label: '数据不足', color: '#8792a5', soft: '#eef1f5' },
}

function MapViewport({ selectedId }) {
  const map = useMap()
  React.useEffect(() => {
    if (selectedId) {
      const store = stores.find((item) => item.id === selectedId)
      if (store) map.flyTo([store.lat, store.lng], 12.4, { duration: 0.5 })
    }
  }, [map, selectedId])
  return null
}

function Metric({ label, value, suffix = '', delta, tone = 'neutral' }) {
  return <div className="metric-block"><span>{label}</span><strong>{value}{suffix}</strong>{delta !== undefined && <em className={`delta ${tone}`}>{delta > 0 ? '+' : ''}{delta}%</em>}</div>
}

function App() {
  const [selectedId, setSelectedId] = useState('A')
  const [compareIds, setCompareIds] = useState([])
  const [view, setView] = useState('map')
  const [query, setQuery] = useState('')
  const [caseOpen, setCaseOpen] = useState(false)
  const selected = stores.find((item) => item.id === selectedId) || stores[0]
  const compareStores = useMemo(() => compareIds.map((id) => stores.find((item) => item.id === id)).filter(Boolean), [compareIds])
  const peerMedian = useMemo(() => Math.round(stores.filter((item) => item.id !== selected.id).reduce((sum, item) => sum + item.sales, 0) / (stores.length - 1)), [selected.id])
  const trendRate = selected.salesGap / 100
  const projected = Math.round(selected.sales * (1 + trendRate))
  const targetGap = projected - peerMedian

  function toggleCompare(id) {
    setCompareIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current)
  }

  function selectStore(id) {
    setSelectedId(id)
    setView('detail')
  }

  const filtered = stores.filter((store) => `${store.name}${store.district}${store.id}`.includes(query))

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={18} /></div><div><strong>Atlas / 经营风险</strong><span>OPERATIONS INTELLIGENCE</span></div></div>
      <div className="topbar-context"><span className="live-dot" />演示数据 · 长春市 <span className="divider" />数据更新于 10:32:08</div>
      <div className="topbar-actions"><button className="icon-button" title="通知"><Bell size={17} /><span className="notification-dot" /></button><div className="avatar">RM</div><span className="role">区域经理</span></div>
    </header>

    <main className="workspace">
      <aside className="sidebar">
        <div className="side-intro"><div className="eyebrow">RISK ATLAS / 01</div><h1>门店经营<br /><span>对标优化</span></h1><p>从空间上发现问题，选择对标对象，并推动单店进入改善复核。</p></div>
        <nav className="nav-list"><button className="nav-item active"><MapPin size={17} />风险地图<span className="nav-count">5</span></button><button className="nav-item" onClick={() => setView('compare')}><Users size={17} />门店对标</button><button className="nav-item" onClick={() => setCaseOpen(true)}><ShieldAlert size={17} />风险案件<span className="nav-count danger">1</span></button></nav>
        <div className="sidebar-section"><div className="section-label">数据范围</div><div className="scope-card"><div><span>区域</span><strong>长春市 · 全部区域</strong></div><ChevronRight size={15} /></div><div className="scope-card"><div><span>观察窗口</span><strong>近 7 天 <small>10.12 — 10.18</small></strong></div><ChevronRight size={15} /></div><div className="scope-card"><div><span>数据版本</span><strong>demo_v1 <small>已锁定</small></strong></div><CheckCircle2 size={15} className="ok-icon" /></div></div>
        <div className="sidebar-section store-list-section"><div className="section-row"><div className="section-label">门店概览 <span>5</span></div><button className="small-icon" title="筛选门店"><SlidersHorizontal size={15} /></button></div><div className="search-box"><Search size={14} /><input placeholder="搜索门店或区域" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="store-list">{filtered.map((store) => <button className={`store-row ${selected.id === store.id ? 'selected' : ''}`} key={store.id} onClick={() => selectStore(store.id)}><span className="mini-status" style={{ background: riskMeta[store.risk].color }} /><span className="store-row-name"><strong>{store.id} · {store.name}</strong><small>{store.district} · {store.address}</small></span><span className="store-row-gap" style={{ color: store.salesGap < -15 ? '#c74743' : store.salesGap < 0 ? '#ad7617' : '#258b68' }}>{store.salesGap > 0 ? '+' : ''}{store.salesGap}%</span></button>)}</div></div>
        <div className="sidebar-footer"><div className="integrity"><span className="integrity-ring">98</span><div><strong>数据完整度</strong><small>5 / 5 门店可对标</small></div></div><button className="help-button" title="查看说明"><CircleHelp size={16} /></button></div>
      </aside>

      <section className="main-panel">
        <div className="main-toolbar"><div><div className="breadcrumb">风险地图 <ChevronRight size={14} /> <span>经营对标工作区</span></div><h2>{view === 'compare' ? '多店对标' : view === 'detail' ? `${selected.id} · ${selected.name}` : '长春门店风险分布'}</h2></div><div className="toolbar-actions"><div className="view-switch"><button className={view === 'map' || view === 'detail' ? 'active' : ''} onClick={() => setView('map')}><MapPin size={14} />地图</button><button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}><Layers3 size={14} />对标</button></div><button className="outline-button" onClick={() => setCaseOpen(true)}><ClipboardCheck size={15} />案件中心 <span className="button-badge">1</span></button></div></div>

        {view === 'compare' ? <CompareView stores={compareStores.length >= 2 ? compareStores : stores.slice(0, 3)} onClose={() => setView('map')} onGenerateCase={() => setCaseOpen(true)} /> : view === 'detail' ? <DetailView store={selected} projected={projected} targetGap={targetGap} peerMedian={peerMedian} onBack={() => setView('map')} onOpenCase={() => setCaseOpen(true)} /> : <>
          <div className="map-stage"><MapContainer center={[43.88, 125.32]} zoom={11.8} zoomControl={false} scrollWheelZoom={true} className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><MapViewport selectedId={selectedId} />{stores.map((store) => <CircleMarker key={store.id} center={[store.lat, store.lng]} radius={store.id === selected.id ? 13 : 10} pathOptions={{ color: store.openCase ? '#fff7f0' : '#ffffff', weight: store.openCase ? 4 : 2, fillColor: riskMeta[store.risk].color, fillOpacity: 0.94 }} eventHandlers={{ click: (event) => event.originalEvent?.metaKey || event.originalEvent?.ctrlKey ? toggleCompare(store.id) : selectStore(store.id) }}><Popup><strong>{store.id} · {store.name}</strong><br />销售额较前周期 {store.salesGap}%<br /><small>按住 Ctrl / Cmd 点击可加入对标</small></Popup></CircleMarker>)}</MapContainer><div className="map-overlay top-left"><span className="map-kicker"><span className="live-dot" /> LIVE / RISK DISTRIBUTION</span><strong>长春市门店经营状态</strong><small>点击门店查看详情 · ⌘ 点击多选进行对标</small></div><div className="map-overlay map-legend"><div className="legend-title">风险状态</div>{Object.entries(riskMeta).slice(0, 3).map(([key, item]) => <div className="legend-item" key={key}><span className="legend-dot" style={{ background: item.color }} />{item.label}</div>)}<div className="legend-divider" /><div className="legend-note"><span className="ring-sample" /> 外圈 = 有未关闭案件</div></div><div className="map-overlay map-stats"><div><strong>5</strong><span>监测门店</span></div><div><strong>1</strong><span>待处理案件</span></div><div><strong>4 / 4</strong><span>可比门店</span></div></div></div>
          <div className="below-map"><div className="insight-bar"><div className="insight-icon"><AlertTriangle size={17} /></div><div><strong>今日优先关注 · A 店</strong><span>退款率高于同类中位数 <b>+4.9pp</b>，销售额下降主要来自订单数减少。</span></div><button onClick={() => selectStore('A')}>查看差距分析 <ChevronRight size={15} /></button></div><div className="quick-panels"><div className="quick-panel"><div className="panel-heading"><span>风险概览</span><button className="small-icon" title="更多"><MoreHorizontal size={16} /></button></div><div className="risk-summary"><div><strong className="red">1</strong><span>可能异常</span></div><div><strong className="amber">2</strong><span>需要关注</span></div><div><strong className="green">2</strong><span>运行正常</span></div></div></div><div className="quick-panel"><div className="panel-heading"><span>对标基准</span><span className="muted-label">同区域中位数</span></div><div className="benchmark-mini"><div><span>销售额</span><strong>¥205,000</strong><em className="delta positive">+6.2%</em></div><div><span>退款率</span><strong>2.1%</strong><em className="delta negative">-4.9pp</em></div><div><span>客单价</span><strong>¥77.1</strong><em className="delta positive">+2.4%</em></div></div></div><div className="quick-panel"><div className="panel-heading"><span>闭环进度</span><span className="muted-label">本周期</span></div><div className="progress-row"><div className="progress-track"><span style={{ width: '72%' }} /></div><strong>72%</strong></div><div className="progress-copy">1 个案件处理中 · 0 个逾期</div></div></div></div>
        </>}
      </section>
    </main>
    {caseOpen && <CaseDrawer store={selected} onClose={() => setCaseOpen(false)} />}
  </div>
}

function CompareView({ stores: compare, onClose, onGenerateCase }) {
  const best = compare.reduce((winner, item) => item.salesGap > winner.salesGap ? item : winner, compare[0])
  return <div className="content-view compare-view"><div className="view-header"><div><span className="eyebrow">BENCHMARK / PEER GROUP</span><h3>{compare.length} 家门店 · 同区域横向对标</h3><p>基准：长春市可比门店中位数 · 当前窗口：10.12 — 10.18</p></div><button className="close-view" onClick={onClose}><X size={16} />返回地图</button></div><div className="compare-callout"><div className="callout-icon"><Target size={18} /></div><div><strong>{best.id} 店当前表现最佳</strong><span>销售额较前周期 <b>+{best.salesGap}%</b>，退款率低于同类中位数。可以作为本次改善的参考样本。</span></div></div><div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>门店</th><th>销售额</th><th>较前周期</th><th>订单数</th><th>客单价</th><th>退款率</th><th>风险</th><th>当前动作</th></tr></thead><tbody>{compare.map((store) => <tr key={store.id} className={store.risk === 'possible' ? 'highlight-row' : ''}><td><div className="table-store"><span className="mini-status" style={{ background: riskMeta[store.risk].color }} /><strong>{store.id} · {store.name}</strong><small>{store.district}</small></div></td><td className="number">¥{store.sales.toLocaleString()}</td><td className={store.salesGap < 0 ? 'negative-text' : 'positive-text'}>{store.salesGap > 0 ? '+' : ''}{store.salesGap}%</td><td className="number">{store.orders.toLocaleString()}</td><td className="number">¥{store.aov}</td><td className={store.refundRate > store.peerRefund ? 'negative-text' : 'positive-text'}>{store.refundRate}%</td><td><span className="status-pill" style={{ color: riskMeta[store.risk].color, background: riskMeta[store.risk].soft }}>{riskMeta[store.risk].label}</span></td><td><span className="action-cell">{store.action}</span></td></tr>)}</tbody></table></div><div className="compare-foot"><div><strong>对标结论</strong><span>优先处理 A 店：销售额、订单数与退款率同时偏离同类基准，建议先核查退款订单。</span></div><button className="primary-button" onClick={onGenerateCase}>生成优化行动 <ChevronRight size={16} /></button></div></div>
}

function DetailView({ store, projected, targetGap, peerMedian, onBack, onOpenCase }) {
  const meta = riskMeta[store.risk]
  return <div className="content-view detail-view"><div className="view-header"><div><button className="back-link" onClick={onBack}><ChevronRight size={14} className="back-chevron" />风险地图</button><div className="detail-title-row"><span className="store-large-id">{store.id}</span><div><h3>{store.name}</h3><p>{store.district} · {store.address} · <span className="demo-tag">模拟位置</span></p></div><span className="status-pill large" style={{ color: meta.color, background: meta.soft }}>{meta.label}</span></div></div><button className="outline-button" onClick={onOpenCase}><ClipboardCheck size={15} />查看案件</button></div><div className="detail-grid"><section className="detail-card performance-card"><div className="card-top"><div><span className="eyebrow">PERFORMANCE / 7D</span><h4>经营变化</h4></div><span className="data-note">vs. 前 7 天</span></div><div className="detail-metrics"><Metric label="销售额" value={`¥${store.sales.toLocaleString()}`} delta={store.salesGap} tone="negative" /><Metric label="订单数" value={store.orders.toLocaleString()} delta={store.ordersGap} tone="negative" /><Metric label="客单价" value={`¥${store.aov}`} delta={store.aovGap} tone="positive" /><Metric label="退款率" value={store.refundRate} suffix="%" delta={store.refundRate - store.peerRefund} tone="negative" /></div><div className="decomposition"><div className="subsection-label">销售额差距拆解</div><div className="decomp-row"><span>订单数贡献</span><div className="bar-track"><span className="bar-negative" style={{ width: '78%' }} /></div><strong>-78%</strong></div><div className="decomp-row"><span>客单价贡献</span><div className="bar-track"><span className="bar-positive" style={{ width: '16%' }} /></div><strong>+16%</strong></div><div className="decomp-caption">订单数下降是销售额变化的主要来源</div></div></section><section className="detail-card outlook-card"><div className="card-top"><div><span className="eyebrow">OUTLOOK / NEXT 7D</span><h4>趋势外推</h4></div><span className="projection-tag">非预测</span></div><div className="trend-visual"><div className="trend-label"><span>当前 7 天</span><strong>¥{store.sales.toLocaleString()}</strong></div><div className="trend-line"><span className="trend-dot start" /><span className="trend-segment down" /><span className="trend-dot end" /><span className="trend-target" /></div><div className="trend-label target"><span>同类目标</span><strong>¥{peerMedian.toLocaleString()}</strong></div></div><div className="projection-result"><div><span>保持当前趋势 · 未来 7 天</span><strong>¥{projected.toLocaleString()}</strong></div><div className={targetGap < 0 ? 'target-gap negative' : 'target-gap positive'}>{targetGap < 0 ? <ArrowDownRight size={17} /> : <ArrowUpRight size={17} />}<strong>{targetGap < 0 ? '' : '+'}¥{Math.abs(targetGap).toLocaleString()}</strong><span>与同类目标差距</span></div></div><p className="disclaimer"><CircleHelp size={13} />趋势外推，仅用于经营判断，不代表确定性预测。</p></section><section className="detail-card action-card"><div className="card-top"><div><span className="eyebrow">ACTION / CASE {store.caseId || '—'}</span><h4>优化行动</h4></div><span className="status-pill" style={{ color: store.openCase ? '#c74743' : '#258b68', background: store.openCase ? '#fde9e7' : '#e7f5ef' }}>{store.openCase ? '处理中' : '无需处理'}</span></div><div className="action-main"><div className="action-priority">P{store.openCase ? 1 : 3}</div><div><strong>{store.action}</strong><p>退款率高于同类门店中位数 <b>+{(store.refundRate - store.peerRefund).toFixed(1)}pp</b>，需要先确认退款原因。</p></div></div><div className="action-meta"><span><Users size={14} />{store.owner}</span><span><Activity size={14} />{store.due}</span><span><ShieldAlert size={14} />{store.trace}</span></div><button className="primary-button full" onClick={onOpenCase}>{store.openCase ? '打开风险案件' : '查看经营记录'}<ChevronRight size={16} /></button></section></div></div>
}

function CaseDrawer({ store, onClose }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="case-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">CASE CENTER / {store.caseId || 'STORE RECORD'}</span><h3>{store.name}</h3></div><button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button></div><div className="drawer-status"><span className="status-pill" style={{ color: '#c74743', background: '#fde9e7' }}>P1 · 处理中</span><span>创建于 10 月 18 日 10:32</span></div><div className="case-section"><div className="subsection-label">案件摘要</div><p>A 店销售额较前周期下降 28%，退款率为 7%，同时高于同类中位数 4.9 个百分点。系统判定为可能存在经营异常。</p></div><div className="case-section"><div className="subsection-label">已核查证据</div><div className="evidence-list"><div><span className="evidence-id">EV-001</span><span>销售额周环比</span><strong>-28%</strong></div><div><span className="evidence-id">EV-002</span><span>退款率 vs. 同类中位数</span><strong>+4.9pp</strong></div><div><span className="evidence-id">EV-003</span><span>订单数贡献</span><strong>-78%</strong></div></div></div><div className="case-section"><div className="subsection-label">行动卡</div><div className="case-action"><div className="action-priority">P1</div><div><strong>抽查最近 20 笔退款订单</strong><span>负责人：区域经理 · 截止：24 小时内</span></div><CheckCircle2 size={17} className="action-check" /></div></div><div className="case-section"><div className="subsection-label">复核条件</div><div className="verify-box"><Gauge size={17} /><span>退款率回落至同类中位数 + 2 个百分点以内，案件可关闭。</span></div></div><div className="drawer-footer"><button className="secondary-button" onClick={onClose}>稍后处理</button><button className="primary-button" onClick={onClose}>开始调查 <ChevronRight size={16} /></button></div></aside></div>
}

createRoot(document.getElementById('root')).render(<App />)
