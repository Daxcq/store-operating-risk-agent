"""
生成莱森购 2 分钟核心路演 PPT 的多格式交付物：
1. 渲染 6 页 1920x1080 超清幻灯片 PNG 预览图（供视觉核验）
2. 生成 16:9 矢量高清 PDF：output/莱森购_2分钟项目路演.pdf
3. 生成原生可编辑 PowerPoint (.pptx)：output/莱森购_2分钟项目路演.pptx（含原生可编辑文本框、卡片形状、对比矩阵表及每页 Speaker Notes 演讲者备注）
"""

from __future__ import annotations
import os
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
import img2pdf
from playwright.sync_api import sync_playwright

ROOT = Path(r"d:\莱森地平线")
HTML_PATH = ROOT / "output" / "莱森购_2分钟项目路演.html"
SLIDES_DIR = ROOT / "tmp" / "ppt-slides"
PDF_PATH = ROOT / "output" / "莱森购_2分钟项目路演.pdf"
PPTX_EDITABLE_PATH = ROOT / "output" / "莱森购_2分钟项目路演.pptx"
PPTX_VISUAL_PATH = ROOT / "output" / "莱森购_2分钟项目路演_高保真视觉版.pptx"


SLIDE_NOTES = [
    "【第1页｜0:00 - 0:12 (12秒)｜封面与核心主旨】\n各位评委老师好！今天为大家展示【莱森购 Retail Intelligence Agent】——一套受契约约束的无人零售经营智能决策平台。我们的核心主旨只有一句话：终结无人零售中“看表猜原因、AI乱算账、分析无闭环”的痛点，让每一次经营诊断都有据可查，让每一次异常告警都形成可复核的行动闭环。",
    "【第2页｜0:12 - 0:35 (23秒)｜应用场景与现实痛点】\n先看我们的应用场景与现实痛点。在无人零售智能柜和连锁门店运营中，区域经理每天面对高频交易与设备状态数据。但现实中存在三大痛点：第一，传统BI报表“只给图不给结论”，比如朝阳A店销售额跌了28%，店长要在几张表里翻找是订单量跌了还是客单价跌了；第二，通用大模型“乱写SQL、幻觉归因”，经常把每日比率直接平均、漏扣员工测试单，甚至看单指标下滑就武断甩锅；第三，“诊断停留在聊天框”，发现异常后没有派单、没有SLA时限，更没有下一周期的效果复核。",
    "【第3页｜0:35 - 1:00 (25秒)｜与传统方案的核心差异】\n那我们和传统的BI看板、以及传统的Text-to-SQL聊天机器人到底有什么不一样？我们采用了独创的“餐厅点菜”契约架构：把确定性规则引擎当“后厨”，把Agent当“服务员”。Agent绝不自己进后厨写SQL、绝不心算比率，只负责听懂问题、调用7个白名单工具；当可比门店少于3家或缺失成本数据时，系统强制输出“证据不足降级”，绝不不懂装懂；更重要的是，我们从“人找数”升级为“IoT主动监控+人机确认复核”的完整闭环。",
    "【第4页｜1:00 - 1:25 (25秒)｜最核心部分展示（一）：确定性引擎与主动监控】\n接下来只展示我们最核心的两大板块。第一板块是“确定性业务引擎与双模感知”：以长春5大城区真实场景为例，当朝阳A店出现异常，系统自动拆解出订单量下滑31%、退款率高达7.0%（远超同城中位数2.1%），并联动区域投放模型测算ROI；同时，后台主动监控Loop实时监听设备心跳，一旦B店冰柜离线满5分钟自动触发告警并唤醒Agent生成核查证据，15分钟未确认自动升级。",
    "【第5页｜1:25 - 1:45 (20秒)｜最核心部分展示（二）：7层受控Agent与行动闭环】\n第二大核心板块是“LangGraph 7层受控Agent架构与行动复核闭环”。我们杜绝开放式裸答，将Agent严格限制在7个白名单工具和固定拓扑顺序内运行。当诊断出A店退款异常后，系统生成结构化行动卡——指定区域经理在24小时内抽查最近20笔退款订单，经人工确认后派发；到了下一周期，系统自动调用verify_task核验退款率是否回落到同城中位数+2%以内，实现真正的管理闭环！",
    "【第6页｜1:45 - 2:00 (15秒)｜未来扩展愿景】\n最后是我们的未来扩展愿景。第一阶段，我们将从模拟切片无缝对接到企业级实时数仓、真实IoT边缘网关与企微/钉钉审批流；第二阶段，横向扩展库存、会员、供应链维度，并引入多模态视觉巡检，自动识别冰柜缺货与开柜防损；第三阶段，基于Supabase已开启的pgvector向量能力，用历史案件的真实复核效果反向调优风险排序权重，构建自演进的无人零售全域自治大脑。谢谢大家！",
]


def render_slides_and_pdf() -> list[Path]:
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)
    png_paths: list[Path] = []

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge")
        except Exception:
            browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.goto(HTML_PATH.as_uri(), wait_until="networkidle")

        # 让 deck 占满 1920x1080 画布并隐藏底部控制栏和提词器以便导出纯净幻灯片
        page.add_style_tag(
            content="""
            body { background: #F7F6F2 !important; }
            .deck-viewport {
              width: 1920px !important;
              height: 1080px !important;
              max-width: none !important;
              max-height: none !important;
              border-radius: 0 !important;
              box-shadow: none !important;
            }
            .presenter-bar, .teleprompter { display: none !important; }
            """
        )

        for i in range(6):
            page.evaluate(f"updateSlide({i})")
            page.wait_for_timeout(150)
            out_png = SLIDES_DIR / f"slide-0{i+1}.png"
            page.screenshot(path=str(out_png), full_page=False)
            png_paths.append(out_png)
            print(f"[OK] Rendered {out_png.name}")

        browser.close()

    # 将 6 张高清图合成为精确 16:9 尺寸的 PDF
    layout_fun = img2pdf.get_layout_fun((img2pdf.mm_to_pt(338.67), img2pdf.mm_to_pt(190.5)))
    with open(PDF_PATH, "wb") as f:
        f.write(img2pdf.convert([str(p) for p in png_paths], layout_fun=layout_fun))
    print(f"[OK] Generated PDF: {PDF_PATH}")
    return png_paths


# ==============================================================================
# 原生 OpenXML (.pptx) 构建器（16:9 宽屏，12192000 x 6858000 EMU）
# ==============================================================================
SLIDE_W = 12192000  # 13.333 inches * 914400
SLIDE_H = 6858000   # 7.5 inches * 914400


def pt_to_emu(pt: float) -> int:
    return int(pt * 12700)


def px_to_emu(px: float) -> int:
    # 以 1920x1080 映射到 12192000x6858000 (1px = 6350 EMU)
    return int(px * 6350)


class ShapeBuilder:
    def __init__(self) -> None:
        self.shapes: list[str] = []
        self.next_id = 2

    def add_rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        fill_hex: str | None = "FFFFFF",
        line_hex: str | None = "E5E0D8",
        line_pt: float = 1.0,
        radius: int = 0,
    ) -> int:
        sid = self.next_id
        self.next_id += 1
        prst = "roundRect" if radius > 0 else "rect"
        av_lst = f'<a:avLst><a:gd name="adj" fmla="val {radius}"/></a:avLst>' if radius > 0 else "<a:avLst/>"
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill_hex}"/></a:solidFill>' if fill_hex else "<a:noFill/>"
        line_xml = (
            f'<a:ln w="{pt_to_emu(line_pt)}"><a:solidFill><a:srgbClr val="{line_hex}"/></a:solidFill></a:ln>'
            if line_hex
            else "<a:ln><a:noFill/></a:ln>"
        )
        self.shapes.append(
            f"""
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="{sid}" name="Rect_{sid}"/>
                <p:cNvSpPr/>
                <p:nvPr/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm>
                  <a:off x="{px_to_emu(x)}" y="{px_to_emu(y)}"/>
                  <a:ext cx="{px_to_emu(w)}" cy="{px_to_emu(h)}"/>
                </a:xfrm>
                <a:prstGeom prst="{prst}">{av_lst}</a:prstGeom>
                {fill_xml}
                {line_xml}
              </p:spPr>
            </p:sp>
            """
        )
        return sid

    def add_textbox(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        paragraphs: list[dict],
        fill_hex: str | None = None,
        line_hex: str | None = None,
        line_pt: float = 1.0,
        pad_px: tuple[float, float, float, float] = (8, 6, 8, 6),
        anchor: str = "t",
    ) -> int:
        """
        paragraphs: list of dict:
          - text: str (or runs: list of dict {text, size, bold, color, font})
          - size: float (pt, e.g. 14)
          - bold: bool
          - color: str (hex, default 111827)
          - align: str ('l', 'ctr', 'r')
          - space_after: float (pt)
          - font: str (default Microsoft YaHei)
        """
        sid = self.next_id
        self.next_id += 1
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill_hex}"/></a:solidFill>' if fill_hex else "<a:noFill/>"
        line_xml = (
            f'<a:ln w="{pt_to_emu(line_pt)}"><a:solidFill><a:srgbClr val="{line_hex}"/></a:solidFill></a:ln>'
            if line_hex
            else "<a:ln><a:noFill/></a:ln>"
        )
        l_ins, t_ins, r_ins, b_ins = [px_to_emu(v) for v in pad_px]

        p_xml_list = []
        for p in paragraphs:
            align = p.get("align", "l")
            spc_aft = p.get("space_after", 4)
            ln_spc = p.get("line_spacing", 130000)  # 130%
            p_pr = (
                f'<a:pPr algn="{align}">'
                f'<a:lnSpc><a:spcPct val="{ln_spc}"/></a:lnSpc>'
                f'<a:spcAft><a:spcPts val="{int(spc_aft * 100)}"/></a:spcAft>'
                f"</a:pPr>"
            )
            runs = p.get("runs")
            if not runs:
                runs = [
                    {
                        "text": p.get("text", ""),
                        "size": p.get("size", 14),
                        "bold": p.get("bold", False),
                        "color": p.get("color", "111827"),
                        "font": p.get("font", "Microsoft YaHei"),
                    }
                ]
            r_xml_list = []
            for r in runs:
                sz = int(r.get("size", p.get("size", 14)) * 100)
                b = "1" if r.get("bold", p.get("bold", False)) else "0"
                clr = r.get("color", p.get("color", "111827"))
                fnt = r.get("font", p.get("font", "Microsoft YaHei"))
                txt = escape(str(r.get("text", "")))
                r_xml_list.append(
                    f"""
                    <a:r>
                      <a:rPr lang="zh-CN" altLang="en-US" sz="{sz}" b="{b}" dirty="0">
                        <a:solidFill><a:srgbClr val="{clr}"/></a:solidFill>
                        <a:latin typeface="{fnt}"/>
                        <a:ea typeface="{fnt}"/>
                      </a:rPr>
                      <a:t>{txt}</a:t>
                    </a:r>
                    """
                )
            p_xml_list.append(f"<a:p>{p_pr}{''.join(r_xml_list)}</a:p>")

        self.shapes.append(
            f"""
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="{sid}" name="TextBox_{sid}"/>
                <p:cNvSpPr txBox="1"/>
                <p:nvPr/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm>
                  <a:off x="{px_to_emu(x)}" y="{px_to_emu(y)}"/>
                  <a:ext cx="{px_to_emu(w)}" cy="{px_to_emu(h)}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                {fill_xml}
                {line_xml}
              </p:spPr>
              <p:txBody>
                <a:bodyPr wrap="square" lIns="{l_ins}" tIns="{t_ins}" rIns="{r_ins}" bIns="{b_ins}" anchor="{anchor}"/>
                <a:lstStyle/>
                {''.join(p_xml_list)}
              </p:txBody>
            </p:sp>
            """
        )
        return sid

    def add_picture(self, r_id: str, x: float, y: float, w: float, h: float) -> int:
        sid = self.next_id
        self.next_id += 1
        self.shapes.append(
            f"""
            <p:pic>
              <p:nvPicPr>
                <p:cNvPr id="{sid}" name="Pic_{sid}"/>
                <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
                <p:nvPr/>
              </p:nvPicPr>
              <p:blipFill>
                <a:blip r:embed="{r_id}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </p:blipFill>
              <p:spPr>
                <a:xfrm>
                  <a:off x="{px_to_emu(x)}" y="{px_to_emu(y)}"/>
                  <a:ext cx="{px_to_emu(w)}" cy="{px_to_emu(h)}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </p:spPr>
            </p:pic>
            """
        )
        return sid

    def to_slide_xml(self) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      {''.join(self.shapes)}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"""


def add_common_frame(
    sb: ShapeBuilder,
    eyebrow: str,
    title: str,
    subtitle: str,
    time_text: str,
    footer_left: str,
    footer_right: str,
) -> None:
    # 背景纸白
    sb.add_rect(0, 0, 1920, 1080, fill_hex="F7F6F2", line_hex=None)
    # 顶部 Header 区
    sb.add_textbox(
        80,
        36,
        1350,
        110,
        [
            {"text": eyebrow, "size": 10.5, "bold": True, "color": "1E3A8A", "space_after": 3},
            {"text": title, "size": 24, "bold": True, "color": "111827", "space_after": 3},
            {"text": subtitle, "size": 12, "bold": False, "color": "4B5563", "space_after": 0},
        ],
        pad_px=(0, 0, 0, 0),
    )
    # 右上时间胶囊
    sb.add_textbox(
        1520,
        44,
        320,
        42,
        [{"text": f"⏱ 路演计时：{time_text}", "size": 11, "bold": True, "color": "C2410C", "align": "ctr"}],
        fill_hex="FFFFFF",
        line_hex="E5E0D8",
        anchor="ctr",
    )
    # Header 分隔线
    sb.add_rect(80, 148, 1760, 2, fill_hex="E5E0D8", line_hex=None)
    # Footer 分隔线与页脚
    sb.add_rect(80, 1012, 1760, 1.5, fill_hex="E5E0D8", line_hex=None)
    sb.add_textbox(
        80,
        1020,
        750,
        36,
        [{"text": footer_left, "size": 10.5, "bold": True, "color": "4B5563"}],
        pad_px=(0, 0, 0, 0),
    )
    sb.add_textbox(
        850,
        1020,
        990,
        36,
        [{"text": footer_right, "size": 10.5, "bold": False, "color": "6B7280", "align": "r"}],
        pad_px=(0, 0, 0, 0),
    )


def build_editable_slides() -> list[tuple[str, list[tuple[str, Path]]]]:
    slides_data: list[tuple[str, list[tuple[str, Path]]]] = []

    # ---------------- SLIDE 1: 封面与核心主旨 ----------------
    sb1 = ShapeBuilder()
    add_common_frame(
        sb1,
        "LAISEN RETAIL INTELLIGENCE AGENT · 2分钟项目路演",
        "莱森购无人零售经营智能决策平台",
        "从“看图猜原因”到“可审计、可复核的行动闭环” · Contract-First Domain Agent",
        "0:00 - 0:12 (12秒 · P1/6)",
        "莱森购 Retail Intelligence Agent  |  P1 · 项目定位与总览",
        "核心理念：确定性规则引擎 × LangGraph 7层受控Agent × IoT主动监控Loop",
    )
    # 左侧大标题与中心主旨卡
    sb1.add_textbox(
        80,
        175,
        1020,
        165,
        [
            {"text": "无人零售经营智能决策平台", "size": 13, "bold": True, "color": "1E3A8A", "space_after": 6},
            {"text": "让每一次经营诊断都有据可查", "size": 34, "bold": True, "color": "0F172A", "space_after": 4},
            {"text": "让每一次异常告警都形成行动闭环", "size": 30, "bold": True, "color": "1E3A8A", "space_after": 0},
        ],
        pad_px=(0, 0, 0, 0),
    )
    sb1.add_rect(80, 355, 1020, 125, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb1.add_rect(80, 355, 8, 125, fill_hex="C2410C", line_hex=None)
    sb1.add_textbox(
        104,
        365,
        980,
        105,
        [
            {"text": "中心主旨（解决什么现实问题？）", "size": 13, "bold": True, "color": "C2410C", "space_after": 4},
            {
                "text": "面向高密度无人零售点位运营，将【确定性指标与规则引擎】、【LangGraph 7层受控 Agent】与【IoT 主动监控 Loop】深度耦合，彻底解决传统报表“只展示不归因”与通用大模型“口径幻觉、不可落地”的现实鸿沟。",
                "size": 13,
                "bold": False,
                "color": "374151",
            },
        ],
    )
    # 左下四宫格亮点
    cards_s1 = [
        ("01 / APPLICATION SCENARIO", "多城多店无人零售高频运营", "覆盖周会问数、单店异常审计、设备离线告警、新点位 ROI 测算"),
        ("02 / PARADIGM SHIFT", "契约优先 · 零 SQL 幻觉", "代码做确定性计算与规则判定，Agent 仅做白名单工具编排与证据表达"),
        ("03 / DUAL-LOOP ENGINE", "被动问数 + IoT 主动监控唤醒", "5分钟超时告警、15分钟升级、自动唤醒 Agent 预审计与多渠道通知"),
        ("04 / VERIFIABLE ACTION", "人机协同 · 下一周期自动复核", "生成带负责人与复核指标的行动卡，达标自动结案、未达标自动升级"),
    ]
    for idx, (k, t, d) in enumerate(cards_s1):
        cx = 80 + (idx % 2) * 520
        cy = 505 + (idx // 2) * 235
        sb1.add_rect(cx, cy, 500, 215, fill_hex="FFFFFF", line_hex="E5E0D8")
        sb1.add_rect(cx, cy, 500, 6, fill_hex="1E3A8A" if idx % 2 == 0 else "C2410C", line_hex=None)
        sb1.add_textbox(
            cx + 18,
            cy + 20,
            464,
            180,
            [
                {"text": k, "size": 10.5, "bold": True, "color": "C2410C", "space_after": 6},
                {"text": t, "size": 16, "bold": True, "color": "111827", "space_after": 8},
                {"text": d, "size": 12.5, "bold": False, "color": "4B5563"},
            ],
        )

    # 右侧深色闭环流程框
    sb1.add_rect(1130, 175, 710, 800, fill_hex="0F172A", line_hex="334155")
    sb1.add_textbox(
        1160,
        195,
        650,
        75,
        [
            {"text": "CORE CLOSED-LOOP ARCHITECTURE", "size": 10.5, "bold": True, "color": "93C5FD", "space_after": 4},
            {"text": "一条全链路可追溯的经营决策闭环", "size": 18, "bold": True, "color": "FFFFFF"},
        ],
    )
    steps_s1 = [
        ("1. 双源触发：自然语言问数 / IoT 心跳异常", "区域经理提问“为什么A店表现差” 或 设备离线 5min 自动唤醒", "1E293B", "334155"),
        ("2. 受控编排：LangGraph 调度 7 大白名单工具", "意图解析 → 权限与参数护栏 → 严禁自由写 SQL 或心算比率", "1E293B", "334155"),
        ("3. 确定性引擎：差距拆解 + 规则命中 + 同店对标", "销售额拆解为订单量×客单价；不足 3 家可比门店强制输出降级结论", "1E293B", "334155"),
        ("4. 证据成案：生成结构化行动卡（人工确认护栏）", "绑定 evidence_id 与 trace_id，明确区域经理、24h期限与复核目标", "1E293B", "334155"),
        ("5. 周期复核：verify_task 自动验证指标闭环", "下一周期退款率回落则 closed 结案，未达标则自动 escalated 升级", "14532D", "22C55E"),
    ]
    for i, (st, sd, bg, bd) in enumerate(steps_s1):
        sy = 285 + i * 125
        sb1.add_rect(1160, sy, 650, 108, fill_hex=bg, line_hex=bd)
        sb1.add_textbox(
            1178,
            sy + 14,
            614,
            82,
            [
                {"text": st, "size": 13.5, "bold": True, "color": "F8FAFC", "space_after": 4},
                {"text": sd, "size": 11.5, "bold": False, "color": "CBD5E1"},
            ],
        )
    sb1.add_textbox(
        1160,
        920,
        650,
        40,
        [{"text": "数据底座：Supabase (PostgreSQL + pgvector)   |   批次：changchun_demo_v1", "size": 10.5, "bold": False, "color": "94A3B8"}],
    )
    slides_data.append((sb1.to_slide_xml(), []))

    # ---------------- SLIDE 2: 应用场景与现实痛点 ----------------
    sb2 = ShapeBuilder()
    add_common_frame(
        sb2,
        "01 · APPLICATION SCENARIOS & REAL-WORLD PAIN POINTS",
        "应用场景与中心主旨：直击无人零售经营的“三大现实痛点”",
        "中心主旨：解决“看得见海量经营数据，却做不出可信、可追责、可复核决策”的业务断层",
        "0:12 - 0:35 (23秒 · P2/6)",
        "莱森购 Retail Intelligence Agent  |  P2 · 应用场景与现实痛点",
        "核心命题：企业不缺展示图表的看板，缺的是受契约约束、带证据链、能转化为闭环行动的决策系统",
    )
    # 顶部深色场景横幅
    sb2.add_rect(80, 170, 1760, 115, fill_hex="0F172A", line_hex="334155")
    sb2.add_textbox(
        105,
        182,
        1710,
        92,
        [
            {"text": "核心落地应用场景（区域经理 / 运营督导 / 选址团队的高频决策工作台 · 以长春 5 大城区无人零售网络为样本）", "size": 12, "bold": True, "color": "93C5FD", "space_after": 8},
            {
                "text": "① 周会经营问数与同城对标      |      ② 门店业绩异动与退款激增审计      |      ③ 7×24h 设备心跳离线主动告警      |      ④ 新商圈点位投放与回本周期测算",
                "size": 15,
                "bold": True,
                "color": "FFFFFF",
            },
        ],
    )
    # 三大现实痛点卡片
    pains = [
        (
            "现实痛点 01 · 传统看表困境",
            "“只给图表，不给归因与证据”",
            "运营人员面对几十张分散的销售、订单、盘点与设备表，看到门店销售额下跌时，需手动跨表排查是【客流订单萎缩】、【客单价下滑】还是【区域性集体波动】，耗时极长且易误判。",
            "真实案例：朝阳 A 店本周销售额突降 -28.0%，传统报表仅标红数字，店长无法一眼识别是订单量暴跌（-31.0%）叠加退款率激增（7.0%）所致。",
        ),
        (
            "现实痛点 02 · 通用 AI 问数之坑",
            "“AI 自由写 SQL 算错账、武断下结论”",
            "直接让 LLM 写 SQL 极易发生【口径事故】：用订单原价代替扣退销售额、漏筛员工测试单、把每日客单价直接取平均（大店小店被同等对待）；且在证据不足时强行编造根因。",
            "致命风险：财务与运营口径不一致（如新开店直接纳入同比导致数据虚高），一句话提示词约束不住 AI 跳步调用，企业根本不敢用于真实经营。",
        ),
        (
            "现实痛点 03 · 落地执行断层",
            "“分析停留在报告，无人跟进与复核”",
            "无论是周会 PPT 还是 AI 聊天框，往往止步于“建议加强管理”的空洞套话。谁去核查？几小时内完成？下周看哪个指标确认修好了？缺乏状态机追踪与主动监控唤醒。",
            "管理黑洞：冰柜离线或异常退款发生时，若无人主动提问就被长期搁置；派发的整改任务没有下一周期的自动指标复核，问题反复重演。",
        ),
    ]
    for idx, (badge, h3, desc, case_txt) in enumerate(pains):
        px = 80 + idx * 596
        py = 310
        pw = 568
        ph = 675
        sb2.add_rect(px, py, pw, ph, fill_hex="FFFFFF", line_hex="E5E0D8")
        sb2.add_rect(px, py, pw, 8, fill_hex="C2410C", line_hex=None)
        sb2.add_textbox(
            px + 24,
            py + 28,
            pw - 48,
            420,
            [
                {"text": badge, "size": 11.5, "bold": True, "color": "C2410C", "space_after": 10},
                {"text": h3, "size": 19, "bold": True, "color": "111827", "space_after": 14},
                {"text": desc, "size": 13.5, "bold": False, "color": "374151"},
            ],
        )
        sb2.add_rect(px + 24, py + 470, pw - 48, 175, fill_hex="FFF7ED", line_hex="FED7AA")
        sb2.add_textbox(
            px + 38,
            py + 482,
            pw - 76,
            150,
            [{"text": case_txt, "size": 12, "bold": False, "color": "9A3412"}],
        )
    slides_data.append((sb2.to_slide_xml(), []))

    # ---------------- SLIDE 3: 与传统方案的核心差异 ----------------
    sb3 = ShapeBuilder()
    add_common_frame(
        sb3,
        "02 · KEY DIFFERENTIATION VS. TRADITIONAL SOLUTIONS",
        "核心差异化：我们与传统 BI 及传统 AI 问数哪里不一样？",
        "核心设计哲学：人守住“契约”与“验收”，确定性代码当“后厨”，大模型当“受控服务员”",
        "0:35 - 1:00 (25秒 · P3/6)",
        "莱森购 Retail Intelligence Agent  |  P3 · 核心差异化对比",
        "牺牲“无边界自由闲聊”的虚假灵活，换取企业级经营决策 100% 可信、可审计、可复核的确定性价值",
    )
    # 餐厅点菜模型横条
    metaphors = [
        ("菜单 = 指标契约库", "预定义公式、同店口径、扣退规则，拒绝临时拼凑"),
        ("服务员 = 受控 Agent", "只做意图解析与白名单点单，0 SQL、0 心算"),
        ("厨师长 = 规则引擎", "代码级确定性判定（如至少满足2项异常才建案）"),
        ("小票 = Trace 证据链", "每个数字绑定 evidence_id 与 trace_id 可回放"),
    ]
    for i, (mr, md) in enumerate(metaphors):
        mx = 80 + i * 445
        sb3.add_rect(mx, 168, 425, 86, fill_hex="FFFFFF", line_hex="BFDBFE")
        sb3.add_textbox(
            mx + 14,
            176,
            397,
            70,
            [
                {"text": mr, "size": 12.5, "bold": True, "color": "1E3A8A", "space_after": 3},
                {"text": md, "size": 11, "bold": False, "color": "4B5563"},
            ],
        )

    # 对比矩阵表（使用精细对齐的网格卡片构建，确保任何软件打开视觉100%整齐）
    col_x = [80, 320, 740, 1200]
    col_w = [240, 420, 460, 640]
    headers = [
        "核心对比维度",
        "传统 BI 报表 / 数据看板",
        "传统 AI Agent / Text-to-SQL",
        "✦ 莱森购 Retail Intelligence Agent（本项目）",
    ]
    for c in range(4):
        is_hl = c == 3
        sb3.add_rect(
            col_x[c],
            272,
            col_w[c],
            58,
            fill_hex="1E3A8A" if is_hl else "EFECE6",
            line_hex="1E3A8A" if is_hl else "D6D3CD",
        )
        sb3.add_textbox(
            col_x[c] + 12,
            280,
            col_w[c] - 24,
            42,
            [{"text": headers[c], "size": 12.5, "bold": True, "color": "FFFFFF" if is_hl else "111827"}],
            anchor="ctr",
        )

    rows_s3 = [
        (
            "1. 指标计算与口径",
            "固定图表展示，跨维拆解需人工导出 Excel 计算",
            "LLM 现场写 SQL 或心算，易把每日比率简单平均、混淆含税/扣退口径",
            "先聚合再算比率（SUM(sales)/NULLIF(SUM(orders),0)），自动拆解订单量与客单价双因子，100% 财务口径对齐",
        ),
        (
            "2. 异常判定与归因",
            "仅提供红绿阈值高亮，靠运营人员凭经验猜原因",
            "单指标下滑即武断定性，甚至编造输入数据中不存在的根因与责任人",
            "多条件确定性规则判定（store_anomaly_v1 至少命中2项）+ 全区域同步波动识别 + 挂载结构化 SOP 知识库",
        ),
        (
            "3. 数据缺失与边界护栏",
            "直接显示空值 NaN 或报错图表",
            "靠提示词软约束，极易强行幻觉作答，无视样本量不足",
            "硬核降级机制：可比门店 < 3家 或缺 CAPEX 成本时（如南关区），强制返回 insufficient 拒算回本期，诚实守界",
        ),
        (
            "4. 触发模式",
            "纯被动：人打开网页看表",
            "纯被动：人输入问题才回复",
            "双轮驱动：人主动自然语言问数 + IoT 心跳主动监控 Loop（离线 5min 告警并自动唤醒 Agent 预审计）",
        ),
        (
            "5. 决策落地与闭环",
            "止步于图表浏览，无任务系统",
            "止步于聊天框建议，甚至危险地自动执行写操作",
            "人机协同状态机：生成结构化行动卡 → 人工确认护栏 → 派单限办 → 下一周期 verify_task 自动核验关闭/升级",
        ),
    ]
    for r_idx, row_vals in enumerate(rows_s3):
        ry = 330 + r_idx * 130
        rh = 130
        for c in range(4):
            is_hl = c == 3
            sb3.add_rect(
                col_x[c],
                ry,
                col_w[c],
                rh,
                fill_hex="F8FAFC" if is_hl else "FFFFFF",
                line_hex="1E3A8A" if is_hl else "E5E0D8",
                line_pt=1.5 if is_hl else 1.0,
            )
            txt_color = "1E3A8A" if is_hl else ("9A3412" if c == 2 else "111827")
            sb3.add_textbox(
                col_x[c] + 14,
                ry + 10,
                col_w[c] - 28,
                rh - 20,
                [
                    {
                        "text": row_vals[c],
                        "size": 12.2,
                        "bold": c in (0, 3),
                        "color": txt_color,
                    }
                ],
                anchor="ctr",
            )
    slides_data.append((sb3.to_slide_xml(), []))

    # ---------------- SLIDE 4: 最核心部分展示（一） ----------------
    sb4 = ShapeBuilder()
    add_common_frame(
        sb4,
        "03 · CORE SHOWCASE PART I — DETERMINISTIC ENGINE & PROACTIVE LOOP",
        "核心部分展示（一）：确定性审计对标引擎 + IoT 主动监控闭环",
        "以长春 5 店真实切片数据（demo_v1）为例：从全局态势、单店归因、区域 ROI 到毫秒级心跳告警",
        "1:00 - 1:25 (25秒 · P4/6)",
        "莱森购 Retail Intelligence Agent  |  P4 · 核心部分展示（上）",
        "区分四类严谨审计状态：正常 / 疑似异常 / 证据不足 (insufficient) / 无法判断 (unavailable)",
    )
    # 左侧 4 个关键指标卡
    metrics_s4 = [
        ("长春全市 7日总销额", "¥105.4万", "利润 ¥21.8万 · 5城区", "FFFFFF", "E5E0D8", "111827"),
        ("朝阳 A店 · 高危异常", "退款率 7.0%", "同城中位 2.1% | 订单 -31%", "FFF7ED", "FED7AA", "C2410C"),
        ("朝阳区 · 投放评分榜首", "81.9 分", "回本 8.4个月 (月利4.28万)", "FFFFFF", "E5E0D8", "1E3A8A"),
        ("南关区 · 数据缺失降级", "回本期 NULL", "缺 CAPEX 强制拒算防幻觉", "FFFBEB", "FDE68A", "B45309"),
    ]
    for i, (ml, mv, ms, mbg, mbd, mclr) in enumerate(metrics_s4):
        mx = 80 + i * 228
        sb4.add_rect(mx, 172, 214, 145, fill_hex=mbg, line_hex=mbd)
        sb4.add_textbox(
            mx + 12,
            182,
            190,
            125,
            [
                {"text": ml, "size": 10.5, "bold": True, "color": "6B7280", "space_after": 6},
                {"text": mv, "size": 18, "bold": True, "color": mclr, "space_after": 6},
                {"text": ms, "size": 10.5, "bold": False, "color": "4B5563"},
            ],
        )

    # 左中：核心能力 A
    sb4.add_rect(80, 338, 898, 290, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb4.add_rect(80, 338, 898, 7, fill_hex="1E3A8A", line_hex=None)
    sb4.add_textbox(
        104,
        358,
        850,
        255,
        [
            {"text": "核心能力 A · 确定性差距拆解与区域 ROI 评分（metric_service + rule_engine）", "size": 14, "bold": True, "color": "1E3A8A", "space_after": 10},
            {
                "text": "• 双因子归因拆解：朝阳 A 店销售额较基线下跌 -28.0%（¥23.89万 → ¥17.20万），引擎自动拆解出【订单量暴跌 -31.0%】为主因，叠加退款率 7.0% 命中高风险规则，避免把客流异常误判为客单价问题。",
                "size": 12.5,
                "bold": False,
                "color": "374151",
                "space_after": 8,
            },
            {
                "text": "• 区域投放 ROI 确定性模型：Score = w1·需求 + w2·竞品 + w3·毛利 - w4·成本。权重由配置文件锁定，LLM 不可篡改；南关区因缺少设备总投入（capex_investment=NULL），强制降级拒算回本周期。",
                "size": 12.5,
                "bold": False,
                "color": "374151",
            },
        ],
    )

    # 左下：核心能力 B 主动监控 Loop
    sb4.add_rect(80, 650, 898, 335, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb4.add_rect(80, 650, 898, 7, fill_hex="15803D", line_hex=None)
    sb4.add_textbox(
        104,
        670,
        850,
        295,
        [
            {"text": "核心能力 B · Agent 主动监控 Loop（无需人提问自动唤醒 · src/agent/monitorLoop.js）", "size": 14, "bold": True, "color": "15803D", "space_after": 10},
            {"text": "状态机流转：detected (2min超时) → alerted (5min告警并唤醒Agent审计) → escalated (15min未确认升级) → resolved (心跳恢复结案)", "size": 12, "bold": True, "color": "111827", "space_after": 10},
            {
                "text": "• 同一设备按 device-offline:{deviceId} 幂等去重；5分钟触发第一封负责人通知并异步调用 Agent 审计链路（保存 agentSummary、agentFindings 与 agentTraceId）。\n• 支持站内通知、外部 Webhook 与 QQ 邮箱 SMTP (SSL 465) 异步告警，本地状态持久化至 agent-monitor-state.json 重启不丢失。",
                "size": 12,
                "bold": False,
                "color": "374151",
            },
        ],
    )

    # 右侧：嵌入两张高清 UI 概念图
    img1 = ROOT / "output" / "imagegen" / "01-paper-navy.png"
    img2 = ROOT / "output" / "imagegen" / "03-ivory-terracotta-v2.png"
    rels_s4: list[tuple[str, Path]] = []
    if img1.exists() and img2.exists():
        sb4.add_rect(1005, 172, 835, 395, fill_hex="FFFFFF", line_hex="E5E0D8")
        sb4.add_textbox(1020, 178, 800, 30, [{"text": "📊 经营驾驶舱与四态审计分布（真实产品视觉概念图 01-paper-navy）", "size": 11.5, "bold": True, "color": "1E3A8A"}])
        sb4.add_picture("rIdImg1", 1020, 212, 805, 342)

        sb4.add_rect(1005, 590, 835, 395, fill_hex="FFFFFF", line_hex="E5E0D8")
        sb4.add_textbox(1020, 596, 800, 30, [{"text": "🔍 门店审计工作台与可比门店对标（真实产品视觉概念图 03-ivory-terracotta）", "size": 11.5, "bold": True, "color": "C2410C"}])
        sb4.add_picture("rIdImg2", 1020, 630, 805, 342)
        rels_s4 = [("rIdImg1", img1), ("rIdImg2", img2)]

    slides_data.append((sb4.to_slide_xml(), rels_s4))

    # ---------------- SLIDE 5: 最核心部分展示（二）7层受控Agent与行动闭环 ----------------
    sb5 = ShapeBuilder()
    add_common_frame(
        sb5,
        "04 · CORE SHOWCASE PART II — 7-LAYER LANGGRAPH AGENT & ACTION VERIFICATION",
        "核心部分展示（二）：LangGraph 7层受控编排与“行动—复核”闭环",
        "严禁脱离工具自由裸答（disallowOpenEndedDirectAnswer = true），高风险写操作强制人工确认",
        "1:25 - 1:45 (20秒 · P5/6)",
        "莱森购 Retail Intelligence Agent  |  P5 · 核心部分展示（下）",
        "7大白名单工具：get_dashboard · run_audit · compare_regions · estimate_region_roi · create_task · verify_task · write_report",
    )
    # 左侧：7层架构栈
    sb5.add_rect(80, 172, 860, 810, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb5.add_textbox(
        104,
        188,
        812,
        40,
        [{"text": "LangGraph 7层工程化受控架构（src/agent/）", "size": 15, "bold": True, "color": "1E3A8A"}],
    )
    layers_s5 = [
        ("1. 定义层 Definition", "冻结身份边界、State Schema 与 7 大白名单工具映射 (definition.js)"),
        ("2. 模式层 Pattern", "意图分类枚举：门店审计 / 区域对比 / 驾驶舱 / 综合分析 / 任务复核 (pattern.js)"),
        ("3. 组件层 Component", "意图解析、上下文构建、工具适配、证据总结器 (components/*)"),
        ("4. 机制层 Mechanism", "固定拓扑序执行、重试退避、云端超时本地内存兜底 (mechanisms.js)"),
        ("5. 安全层 Safety", "防 Prompt 注入、防越权写操作、禁止编造未返回数值 (safety.js)"),
        ("6. 编排层 Orchestrator", "LangGraph 状态图流转与主动监控 Loop 唤醒桥接 (orchestrator.js)"),
        ("7. 工程层 Engineering", "REST API 契约网关、幂等键控制、全链路 Trace 落库 (api.js / traceLogger.js)"),
    ]
    for i, (lt, ld) in enumerate(layers_s5):
        ly = 242 + i * 102
        is_safety = i == 4
        sb5.add_rect(104, ly, 812, 88, fill_hex="FFF7ED" if is_safety else "F7F6F2", line_hex="FED7AA" if is_safety else "E5E0D8")
        sb5.add_rect(104, ly, 8, 88, fill_hex="C2410C" if is_safety else "1E3A8A", line_hex=None)
        sb5.add_textbox(
            124,
            ly + 10,
            776,
            68,
            [
                {"text": lt, "size": 13, "bold": True, "color": "C2410C" if is_safety else "1E3A8A", "space_after": 3},
                {"text": ld, "size": 11.5, "bold": False, "color": "374151"},
            ],
        )

    # 右上：可执行行动卡契约
    sb5.add_rect(970, 172, 870, 515, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb5.add_rect(970, 172, 870, 7, fill_hex="1E3A8A", line_hex=None)
    sb5.add_textbox(
        998,
        192,
        814,
        45,
        [{"text": "可执行行动卡契约（Action Card Schema · 需人工确认后触发 create_task）", "size": 14.5, "bold": True, "color": "1E3A8A"}],
    )
    sb5.add_rect(998, 245, 814, 415, fill_hex="0F172A", line_hex="334155")
    sb5.add_textbox(
        1020,
        262,
        770,
        385,
        [
            {"text": "{", "size": 12, "bold": True, "color": "93C5FD", "font": "Consolas", "space_after": 3},
            {"text": '  "task_id": "task_chaoyang_A_001",', "size": 12, "bold": False, "color": "86EFAC", "font": "Consolas", "space_after": 3},
            {"text": '  "problem": "朝阳A店退款率(7.0%)显著高于同城中位数(2.1%)，订单跌31%",', "size": 12, "bold": False, "color": "FDE047", "font": "Consolas", "space_after": 3},
            {"text": '  "evidence_ids": ["ev_audit_A_refund", "ev_peer_changchun"],', "size": 12, "bold": False, "color": "86EFAC", "font": "Consolas", "space_after": 3},
            {"text": '  "action": "抽查最近 20 笔退款订单，核查冷链温控与商品临期状态",', "size": 12.5, "bold": True, "color": "FFFFFF", "font": "Consolas", "space_after": 3},
            {"text": '  "owner_role": "长春朝阳区域经理",  "due_hours": 24,', "size": 12, "bold": False, "color": "FBA94C", "font": "Consolas", "space_after": 3},
            {"text": '  "verify_metric": "refund_rate",', "size": 12, "bold": False, "color": "86EFAC", "font": "Consolas", "space_after": 3},
            {"text": '  "verify_target": "下一周期回落至同城中位数 + 2.0%（即 ≤ 4.1%）以内"', "size": 12, "bold": False, "color": "86EFAC", "font": "Consolas", "space_after": 3},
            {"text": "}", "size": 12, "bold": True, "color": "93C5FD", "font": "Consolas", "space_after": 0},
        ],
    )

    # 右下：任务复核状态机
    sb5.add_rect(970, 710, 870, 272, fill_hex="FFFFFF", line_hex="E5E0D8")
    sb5.add_rect(970, 710, 870, 7, fill_hex="15803D", line_hex=None)
    sb5.add_textbox(
        998,
        730,
        814,
        235,
        [
            {"text": "任务生命周期与下一周期自动复核（verify_task）", "size": 14.5, "bold": True, "color": "15803D", "space_after": 12},
            {"text": "open (生成草案)  →  assigned (人工确认派单)  →  verifying (读取下周期指标)  →  closed / escalated", "size": 13, "bold": True, "color": "111827", "space_after": 12},
            {
                "text": "闭环验证逻辑：下一周期自动拉取朝阳 A 店最新 refund_rate，若回落至 ≤ 4.1% 则自动标记 closed 并归档复核证据；若仍超标则自动触发 escalated 升级督办，彻底杜绝“发完报告没人管”。",
                "size": 12.5,
                "bold": False,
                "color": "374151",
            },
        ],
    )
    slides_data.append((sb5.to_slide_xml(), []))

    # ---------------- SLIDE 6: 未来扩展愿景 ----------------
    sb6 = ShapeBuilder()
    add_common_frame(
        sb6,
        "05 · FUTURE EXPANSION VISION & ROADMAP",
        "未来扩展愿景：从“单域智能审计”迈向“全域自治零售大脑”",
        "架构预留标准化契约与 pgvector 向量检索底座，支持三阶段平滑演进",
        "1:45 - 2:00 (15秒 · P6/6)",
        "莱森购 Retail Intelligence Agent  |  P6 · 未来扩展愿景",
        "2分钟核心路演结束 · 支持现场切换至 Live Demo 演示（朝阳 A 店审计闭环 & 主动监控 Loop）",
    )
    visions = [
        (
            "阶段一 · 连接真实世界 (近期)",
            "实时数仓与边缘 IoT 网关全面接轨",
            "• 生产级数据接入：从 CSV/Supabase 种子切片平滑切换至实时 POS 流水、ERP 库存与外部地理/客流 API 适配器。\n• 真实 IoT 边缘网关：将主动监控 Loop 接入智能冰柜温控、门磁与电压传感器，实现秒级硬件故障预判。\n• 企业级协同触达：打通企业微信、飞书与钉钉卡片审批，店长在手机端一键确认行动卡并上传整改照片。",
            "架构优势：当前前后端 API 契约与模块化单体已完全解耦，替换底层数据源零需重写前端与 Agent 编排层。",
            "1E3A8A",
            "EFF6FF",
            "BFDBFE",
        ),
        (
            "阶段二 · 多模态与全域扩维 (中期)",
            "多模态视觉巡检 + 业财供应链全链路",
            "• 多模态视觉审计：融合智能柜摄像头图像识别，自动检测【货架缺货率、陈列合规度、异常拿取防损】，生成视觉证据 ID。\n• 经营维度扩展：在销售额/退款率基础上，纳入【商品保质期损耗、会员复购率、营销活动归因与补货人效】指标库。\n• 跨城多租户治理：引入 RBAC 区域权限隔离、多级审批流与 SLA 考核看板，支撑千店级规模化运营。",
            "演进原则：视觉与预测模型同样遵循“只输出带置信度的结构化证据，由确定性规则定级”的安全边界。",
            "C2410C",
            "FFF7ED",
            "FED7AA",
        ),
        (
            "阶段三 · 自演进决策飞轮 (远期)",
            "基于复核结果反哺的自治零售大脑",
            "• 历史案件向量检索（pgvector）：将每一次结案的异常特征、处置动作与复核改善幅度存入向量库，新发异常自动匹配历史最优 SOP。\n• 策略权重动态校准：根据历史任务复核通过率（Closed vs Escalated），自动评估哪些行动建议真正有效，反哺风险排序模型。\n• 受控多 Agent 协同：在契约稳定后，由审计 Agent、选址 Agent 与供应链补货 Agent 协同推演全局利润最大化方案。",
            "终极愿景：让每一家无人零售小店都拥有一位“算得准、守规矩、盯得住结果”的 AI 首席运营官。",
            "15803D",
            "F0FDF4",
            "BBF7D0",
        ),
    ]
    for idx, (v_badge, v_title, v_list, v_foot, v_clr, v_bg, v_bd) in enumerate(visions):
        vx = 80 + idx * 596
        vy = 172
        vw = 568
        vh = 700
        sb6.add_rect(vx, vy, vw, vh, fill_hex="FFFFFF", line_hex="E5E0D8")
        sb6.add_rect(vx, vy, vw, 8, fill_hex=v_clr, line_hex=None)
        sb6.add_textbox(
            vx + 24,
            vy + 26,
            vw - 48,
            465,
            [
                {"text": v_badge, "size": 11.5, "bold": True, "color": v_clr, "space_after": 10},
                {"text": v_title, "size": 18.5, "bold": True, "color": "111827", "space_after": 14},
                {"text": v_list, "size": 12.8, "bold": False, "color": "374151"},
            ],
        )
        sb6.add_rect(vx + 24, vy + 510, vw - 48, 160, fill_hex=v_bg, line_hex=v_bd)
        sb6.add_textbox(
            vx + 36,
            vy + 522,
            vw - 72,
            136,
            [{"text": v_foot, "size": 11.8, "bold": True, "color": v_clr}],
        )

    # 底部总结金句横幅
    sb6.add_rect(80, 895, 1760, 95, fill_hex="0F172A", line_hex="334155")
    sb6.add_textbox(
        105,
        912,
        1710,
        60,
        [
            {
                "text": "🎯 总结：莱森购不是又一个“会聊天的报表插件”，而是用【确定性工程契约】驯服大模型、打通【感知→归因→行动→复核】的新一代智能经营范式。   |   THANK YOU · Q&A",
                "size": 13.5,
                "bold": True,
                "color": "FFFFFF",
            }
        ],
        anchor="ctr",
    )
    slides_data.append((sb6.to_slide_xml(), []))

    return slides_data


def build_visual_slides(png_paths: list[Path]) -> list[tuple[str, list[tuple[str, Path]]]]:
    slides_data: list[tuple[str, list[tuple[str, Path]]]] = []
    for i, png in enumerate(png_paths):
        sb = ShapeBuilder()
        r_id = f"rIdFullSlide{i+1}"
        sb.add_picture(r_id, 0, 0, 1920, 1080)
        slides_data.append((sb.to_slide_xml(), [(r_id, png)]))
    return slides_data


def write_pptx_package(
    out_path: Path,
    slides_data: list[tuple[str, list[tuple[str, Path]]]],
    notes_list: list[str],
) -> None:
    num_slides = len(slides_data)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. [Content_Types].xml
        slide_overrides = "\n".join(
            f'  <Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>\n'
            f'  <Override PartName="/ppt/notesSlides/notesSlide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>'
            for i in range(1, num_slides + 1)
        )
        content_types = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
{slide_overrides}
</Types>"""
        zf.writestr("[Content_Types].xml", content_types)

        # 2. _rels/.rels
        zf.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""",
        )

        # 3. ppt/presentation.xml & _rels
        sld_id_entries = "\n".join(
            f'    <p:sldId id="{255 + i}" r:id="rIdSlide{i}"/>' for i in range(1, num_slides + 1)
        )
        zf.writestr(
            "ppt/presentation.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdMaster1"/>
  </p:sldMasterIdLst>
  <p:notesMasterIdLst>
    <p:notesMasterId r:id="rIdNotesMaster1"/>
  </p:notesMasterIdLst>
  <p:sldIdLst>
{sld_id_entries}
  </p:sldIdLst>
  <p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}" type="custom"/>
  <p:notesSz cx="{SLIDE_H}" cy="{SLIDE_W}"/>
</p:presentation>""",
        )

        pres_rels = "\n".join(
            f'  <Relationship Id="rIdSlide{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
            for i in range(1, num_slides + 1)
        )
        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rIdNotesMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rIdPresProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>
  <Relationship Id="rIdViewProps" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>
  <Relationship Id="rIdTableStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>
{pres_rels}
</Relationships>""",
        )

        # 4. Auxiliary props & theme
        zf.writestr(
            "ppt/presProps.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presProps xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
        )
        zf.writestr(
            "ppt/viewProps.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewProps xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
        )
        zf.writestr(
            "ppt/tableStyles.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>',
        )

        theme_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LaisenTheme">
  <a:themeElements>
    <a:clrScheme name="LaisenColors">
      <a:dk1><a:srgbClr val="111827"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="0F172A"/></a:dk2>
      <a:lt2><a:srgbClr val="F7F6F2"/></a:lt2>
      <a:accent1><a:srgbClr val="1E3A8A"/></a:accent1>
      <a:accent2><a:srgbClr val="C2410C"/></a:accent2>
      <a:accent3><a:srgbClr val="15803D"/></a:accent3>
      <a:accent4><a:srgbClr val="B45309"/></a:accent4>
      <a:accent5><a:srgbClr val="2563EB"/></a:accent5>
      <a:accent6><a:srgbClr val="4B5563"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="1E3A8A"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="LaisenFonts">
      <a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="LaisenFmt">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>"""
        zf.writestr("ppt/theme/theme1.xml", theme_xml)

        # 5. SlideMaster, SlideLayout, NotesMaster
        zf.writestr(
            "ppt/slideMasters/slideMaster1.xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout1"/></p:sldLayoutIdLst>
</p:sldMaster>""",
        )
        zf.writestr(
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>""",
        )
        zf.writestr(
            "ppt/slideLayouts/slideLayout1.xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>""",
        )
        zf.writestr(
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>""",
        )
        zf.writestr(
            "ppt/notesMasters/notesMaster1.xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
               xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
               xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
</p:notesMaster>""",
        )
        zf.writestr(
            "ppt/notesMasters/_rels/notesMaster1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdTheme1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>""",
        )

        # 6. Write Slides, Media, and Speaker Notes
        media_counter = 1
        for i, (slide_xml, img_rels) in enumerate(slides_data, start=1):
            zf.writestr(f"ppt/slides/slide{i}.xml", slide_xml)

            rel_lines = [
                '  <Relationship Id="rIdLayout1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
                f'  <Relationship Id="rIdNotes{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide{i}.xml"/>',
            ]
            for r_id, img_path in img_rels:
                ext = img_path.suffix.lower()
                media_name = f"image{media_counter}{ext}"
                media_counter += 1
                zf.write(img_path, f"ppt/media/{media_name}")
                rel_lines.append(
                    f'  <Relationship Id="{r_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{media_name}"/>'
                )

            zf.writestr(
                f"ppt/slides/_rels/slide{i}.xml.rels",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{chr(10).join(rel_lines)}
</Relationships>""",
            )

            # Speaker Notes
            note_text = escape(notes_list[i - 1] if i - 1 < len(notes_list) else "")
            zf.writestr(
                f"ppt/notesSlides/notesSlide{i}.xml",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="zh-CN" sz="1200"/><a:t>{note_text}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>""",
            )
            zf.writestr(
                f"ppt/notesSlides/_rels/notesSlide{i}.xml.rels",
                f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdSlide{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide{i}.xml"/>
  <Relationship Id="rIdNotesMaster1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>""",
            )


def main() -> None:
    png_paths = render_slides_and_pdf()
    editable_slides = build_editable_slides()
    write_pptx_package(PPTX_EDITABLE_PATH, editable_slides, SLIDE_NOTES)
    print(f"[OK] Generated Native Editable PPTX: {PPTX_EDITABLE_PATH}")

    visual_slides = build_visual_slides(png_paths)
    write_pptx_package(PPTX_VISUAL_PATH, visual_slides, SLIDE_NOTES)
    print(f"[OK] Generated High-Fidelity Visual PPTX: {PPTX_VISUAL_PATH}")


if __name__ == "__main__":
    main()
