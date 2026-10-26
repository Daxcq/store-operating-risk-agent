# -*- coding: utf-8 -*-
"""
生成《莱森购 Retail Intelligence Agent — 2分钟项目路演（7页全核心亮点版）》的多格式交付物：
1. 渲染 7 页 1920x1080 超清幻灯片 PNG 预览图（tmp/ppt-slides/slide-01.png ~ slide-07.png）
2. 生成 16:9 矢量级高清 PDF：output/莱森购_2分钟项目路演.pdf
3. 生成原生可编辑 PowerPoint (.pptx)：output/莱森购_2分钟项目路演.pptx（含原生可编辑文本框、卡片形状、对比矩阵表、嵌入 UI 概念图及每页 Speaker Notes 演讲者备注）
4. 生成高保真视觉版 PowerPoint (.pptx)：output/莱森购_2分钟项目路演_高保真视觉版.pptx（100% 还原 HTML 精细排版 + 演讲者备注）
"""

from __future__ import annotations
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
import img2pdf
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "output" / "莱森购_2分钟项目路演.html"
SLIDES_DIR = ROOT / "tmp" / "ppt-slides"
PDF_PATH = ROOT / "output" / "莱森购_2分钟项目路演.pdf"
PPTX_EDITABLE_PATH = ROOT / "output" / "莱森购_2分钟项目路演.pptx"
PPTX_VISUAL_PATH = ROOT / "output" / "莱森购_2分钟项目路演_高保真视觉版.pptx"

TOTAL_SLIDES = 7

# 7页 2分钟（120秒）演讲者逐字备注
SPEAKER_NOTES = [
    (
        "【P1｜封面与中心主旨｜00:00 - 00:12（12秒）】\n"
        "各位评委老师好！今天用两分钟为您汇报《莱森购 Retail Intelligence Agent——无人零售经营智能决策平台》。\n"
        "我们的中心主旨只有一句话：把门店大盘、规则审计、同城对标、区域选址、Agent 顾问、主动监控与任务复核融进同一条契约闭环，"
        "回答“关注谁、差在哪且证据是什么、现在做什么何时复核”三大问题，让无人零售经营从“看报表猜原因”进化到“给证据、派动作、验结果”！"
    ),
    (
        "【P2｜应用场景与三大现实痛点｜00:12 - 00:30（18秒）】\n"
        "在无人零售高密度运营中，区域经理每天都在面对五大高频场景：全域风险巡检、异常门店同城对标、新商区选址测算、设备离线抢修与整改复核。\n"
        "但现实中存在三大致命痛点：\n"
        "第一，传统 BI 只给图表不给归因，平均值掩盖斜坡下滑，甚至把 S004 退款字段断报误判为 0 异常（致命假阴性）；\n"
        "第二，通用大模型自由写 SQL 极易算错比率（平均每日比率）、在样本不足时强行编造幻觉数字；\n"
        "第三，分析与执行割裂，聊完即止，没人盯设备心跳、更没有下一周期的复核闭环。"
    ),
    (
        "【P3｜与传统方案的本质不同｜00:30 - 00:50（20秒）】\n"
        "莱森购与传统方案的本质不同，可以用“餐厅后厨”架构隐喻来概括：\n"
        "我们绝不让大模型进后厨自己炒菜算账，而是由冻结的 API Contract v0.1 与确定性领域服务担任“后厨”，大模型只做“服务员”，"
        "在 7 个白名单工具内做意图编排与证据解读。\n"
        "叠加四值防呆熔断、双向数值核验、KV Cache 六大铁律以及主动监控引擎，实现了五大维度的代际跨越！"
    ),
    (
        "【P4｜核心重点（一）：五位一体工作台 + 确定性数据与 Wiki 底座｜00:50 - 01:10（20秒）】\n"
        "下面看最核心的三大技术模块。首先是前端五合一工作台与确定性数据底座：\n"
        "前端将驾驶舱、审计对标、区域选址、行动中心与“莱财”AI顾问及检测台融为一体；\n"
        "后端数据层不仅锁定了先聚合后算比率、订单×客单价双因子拆解、按门店中位数测算区域 ROI，还独创了“两层逐指标可比准入”与“四值规则状态机”"
        "（unavailable -> insufficient -> possible -> none）——例如 S004 退款断报时自动触发 unavailable 熔断，同时保留其完整销售数据参与同区对标；\n"
        "配合 Supabase 4张核心表与结构化 knowledge_wiki，支持内存夹具、Python 离线与云端数据库三路径无缝切换！"
    ),
    (
        "【P5｜核心重点（二）：LangGraph 七层编排 + KV Cache & 三层记忆 + 双向护栏｜01:10 - 01:30（20秒）】\n"
        "第二大核心重点是 C 端的 LangGraph 七层智能体架构与高性能上下文工程：\n"
        "我们将智能体解耦为定义、模式、组件、机制、安全、编排、工程七层，组装了包含单次有界重规划（Bounded Re-plan）的 7 节点状态机；\n"
        "同时严格落地《上下文与 KV Cache 约束》六大铁律（静态前缀 deepFreeze、Append-Only、SHA-256 哈希持久化摘要压缩）与三层记忆体系，"
        "支持像“那帮它创建整改任务”这样的跨轮次指代消解；\n"
        "再配合输入越权拦截与输出 collectAllowedNumbers 数值白名单核验，实现了 100% 零数值幻觉与全业务脱敏表达！"
    ),
    (
        "【P6｜核心重点（三）：人机协同任务复核 + IoT 主动监控双闭环｜01:30 - 01:48（18秒）】\n"
        "第三大核心重点是我们的“双闭环落地引擎”：\n"
        "左边是人机协同经营行动闭环，Agent 生成带同行证据与预期收益的 decisionProposal 审批卡，人工确认后幂等建单，"
        "经历 open -> assigned -> investigating -> verifying -> closed/escalated 状态流转，并在下一周期根据复核指标自动关闭或升级；\n"
        "右边是独立运行的 IoT 主动监控 Loop，2 分钟心跳超时自动检测去重、5 分钟通知负责人（站内+Webhook+QQ邮箱SSL）并自动唤醒 Agent 异步审计、"
        "15 分钟未确认自动升级，真正做到无人值守也有据可查！"
    ),
    (
        "【P7｜未来扩展愿景：三阶段演进蓝图｜01:48 - 02:00（12秒）】\n"
        "最后来看未来扩展愿景。我们将分三步演进：\n"
        "第一阶段落地生产级 OIDC 多租户 RLS 权限隔离，打通真实 IoT 边缘网关与 ERP 实时数仓；\n"
        "第二阶段横向扩展库存、会员、排班人效与边缘多模态视觉识别，实现缺货与陈列自动巡检；\n"
        "第三阶段全面激活 Supabase 预留的 pgvector 1536 维向量列，用每次任务复核的真实改善率反哺风险权重，演进为自进化的多 Agent 无人零售经营大脑。谢谢各位老师！"
    ),
]


def render_slides_and_pdf() -> list[Path]:
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)
    png_paths: list[Path] = []
    url = HTML_PATH.as_uri()

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge")
        except Exception:
            browser = p.chromium.launch(channel="chrome")

        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.goto(f"{url}?export=1", wait_until="networkidle")
        page.wait_for_timeout(300)

        for idx in range(1, TOTAL_SLIDES + 1):
            page.evaluate(f"window.goToSlide({idx})")
            page.wait_for_timeout(160)
            out_png = SLIDES_DIR / f"slide-0{idx}.png"
            page.screenshot(path=str(out_png), full_page=False)
            png_paths.append(out_png)
            print(f"[OK] Rendered {out_png.name}")

        browser.close()

    # 将 7 张高清图合成为精确 16:9 尺寸的 PDF
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
        line_hex: str | None = "DCD6C8",
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
            ln_spc = p.get("line_spacing", 128000)
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
                        "size": p.get("size", 13),
                        "bold": p.get("bold", False),
                        "color": p.get("color", "142030"),
                        "font": p.get("font", "Microsoft YaHei"),
                    }
                ]
            r_xml_list = []
            for r in runs:
                sz = int(r.get("size", p.get("size", 13)) * 100)
                b = "1" if r.get("bold", p.get("bold", False)) else "0"
                clr = r.get("color", p.get("color", "142030"))
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
    sb.add_rect(0, 0, 1920, 1080, fill_hex="F6F3EC", line_hex=None)
    sb.add_textbox(
        76,
        32,
        1360,
        112,
        [
            {"text": eyebrow, "size": 10.5, "bold": True, "color": "1E3A5F", "space_after": 3},
            {"text": title, "size": 22.5, "bold": True, "color": "142030", "space_after": 3},
            {"text": subtitle, "size": 11.5, "bold": False, "color": "3E4E63", "space_after": 0},
        ],
        pad_px=(0, 0, 0, 0),
    )
    sb.add_textbox(
        1480,
        40,
        364,
        42,
        [{"text": f"⏱ {time_text}", "size": 10.5, "bold": True, "color": "C84B31", "align": "ctr"}],
        fill_hex="FFFFFF",
        line_hex="DCD6C8",
        anchor="ctr",
    )
    sb.add_rect(76, 146, 1768, 2, fill_hex="142030", line_hex=None)
    sb.add_rect(76, 1014, 1768, 1.5, fill_hex="DCD6C8", line_hex=None)
    sb.add_textbox(
        76,
        1022,
        760,
        34,
        [{"text": footer_left, "size": 10, "bold": True, "color": "1E3A5F"}],
        pad_px=(0, 0, 0, 0),
    )
    sb.add_textbox(
        850,
        1022,
        994,
        34,
        [{"text": footer_right, "size": 10, "bold": False, "color": "6C7A8C", "align": "r"}],
        pad_px=(0, 0, 0, 0),
    )


def add_bullet_card_xml(
    sb: ShapeBuilder,
    x: float,
    y: float,
    w: float,
    h: float,
    eyebrow: str,
    title: str,
    bullets: list[str],
    top_hex: str = "1E3A5F",
    footer_text: str | None = None,
    footer_bg: str = "EFECE4",
    footer_clr: str = "1E3A5F",
) -> None:
    sb.add_rect(x, y, w, h, fill_hex="FFFFFF", line_hex="DCD6C8")
    sb.add_rect(x, y, w, 7, fill_hex=top_hex, line_hex=None)
    paras: list[dict] = [
        {"text": eyebrow, "size": 9.8, "bold": True, "color": top_hex, "space_after": 4},
        {"text": title, "size": 15.5, "bold": True, "color": "142030", "space_after": 8},
    ]
    for b in bullets:
        paras.append(
            {
                "runs": [
                    {"text": "▪ ", "size": 11.5, "bold": True, "color": top_hex},
                    {"text": b, "size": 11.5, "bold": False, "color": "3E4E63"},
                ],
                "space_after": 5,
            }
        )
    body_h = h - (100 if footer_text else 28)
    sb.add_textbox(x + 20, y + 18, w - 40, body_h, paras)
    if footer_text:
        fy = y + h - 76
        sb.add_rect(x + 18, fy, w - 36, 58, fill_hex=footer_bg, line_hex=None)
        sb.add_textbox(
            x + 28,
            fy + 6,
            w - 56,
            46,
            [{"text": footer_text, "size": 10.5, "bold": True, "color": footer_clr}],
            anchor="ctr",
        )


def build_editable_slides() -> list[tuple[str, list[tuple[str, Path]]]]:
    slides_data: list[tuple[str, list[tuple[str, Path]]]] = []

    # ==================== P1: 封面与中心主旨 ====================
    sb1 = ShapeBuilder()
    add_common_frame(
        sb1,
        "EXECUTIVE PITCH // 01 · 2分钟项目路演（全核心亮点版）",
        "莱森购 Retail Intelligence Agent｜无人零售经营智能决策平台",
        "从“看报表猜原因”到“给证据、派动作、验结果” · A（前端五视图）× B（确定性数据与Wiki）× C（LangGraph智能体与监控Loop）",
        "00:00 - 00:12 (12秒 · P1/7)",
        "莱森购 Retail Intelligence Agent  |  P1 · 项目总览与中心主旨",
        "核心主旨：用冻结契约、四值规则引擎、LangGraph 受控编排、KV Cache 六大铁律与双闭环重塑无人零售决策",
    )
    sb1.add_textbox(
        76,
        162,
        1020,
        130,
        [
            {"text": "CONTRACT-FIRST · LANGGRAPH 7-LAYER AGENT · PROACTIVE IOT LOOP", "size": 10.5, "bold": True, "color": "1E3A5F", "space_after": 4},
            {"text": "回答三大核心经营问题 · 构建六步全链路闭环", "size": 28, "bold": True, "color": "142030", "space_after": 4},
            {"text": "1. 哪些门店或区域需要关注？   2. 差距来自哪里、证据是什么？   3. 现在做什么、何时复核有效？", "size": 13, "bold": True, "color": "C84B31"},
        ],
        pad_px=(0, 0, 0, 0),
    )
    sb1.add_rect(76, 300, 1020, 145, fill_hex="FFFFFF", line_hex="DCD6C8")
    sb1.add_rect(76, 300, 8, 145, fill_hex="C84B31", line_hex=None)
    sb1.add_textbox(
        98,
        310,
        980,
        125,
        [
            {"text": "中心主旨（Central Thesis）", "size": 12.5, "bold": True, "color": "C84B31", "space_after": 4},
            {
                "text": "系统目标不是堆砌更多图表，而是把【门店经营数据、四值审计规则、同城对标、区域选址ROI、LangGraph 7工具智能体、IoT主动心跳监控与人工确认复核】放在同一条契约闭环里：确定性指标与异常由代码计算，Agent 仅在白名单工具与数值护栏内做编排与解读。",
                "size": 12,
                "bold": False,
                "color": "3E4E63",
            },
        ],
    )
    # 6步闭环卡片
    loop_6 = [
        ("STEP 01 · 双源感知", "提问 & 监控唤醒", "自然语言问数 或 IoT离线5min自动唤醒"),
        ("STEP 02 · 受控规划", "白名单工具编排", "LangGraph 7节点状态机 + 单次有界重规划"),
        ("STEP 03 · 确定计算", "指标 / 对标 / 选址", "订单×客单价拆解、两层准入、中位数ROI"),
        ("STEP 04 · 证据防呆", "四值状态 & 护栏", "unavailable优先熔断 + 输出数值白名单核验"),
        ("STEP 05 · 人机协同", "审批建单与派发", "生成 decisionProposal 经人工确认幂等建单"),
        ("STEP 06 · 周期验证", "复核关闭或升级", "下一周期 verify_task 达标关闭、未达标升级"),
    ]
    for i, (sk, st, sd) in enumerate(loop_6):
        cx = 76 + (i % 3) * 346
        cy = 465 + (i // 3) * 165
        sb1.add_rect(cx, cy, 328, 150, fill_hex="FFFFFF", line_hex="DCD6C8")
        sb1.add_rect(cx, cy, 328, 6, fill_hex="1E3A5F" if i % 2 == 0 else "C84B31", line_hex=None)
        sb1.add_textbox(
            cx + 14,
            cy + 14,
            300,
            125,
            [
                {"text": sk, "size": 9.5, "bold": True, "color": "C84B31", "space_after": 4},
                {"text": st, "size": 14, "bold": True, "color": "142030", "space_after": 4},
                {"text": sd, "size": 11, "bold": False, "color": "3E4E63"},
            ],
        )

    sb1.add_rect(76, 805, 1020, 190, fill_hex="142030", line_hex="1E3A5F")
    sb1.add_textbox(
        96,
        818,
        980,
        165,
        [
            {"text": "全栈核心模块一览（A + B + C 三端深度协同）", "size": 12, "bold": True, "color": "FCD34D", "space_after": 6},
            {"text": "• A 端（前端五合一工作台）：经营驾驶舱(GIS地图+42天斜坡) / 智能审计与对标 / 区域投放决策 / 行动中心 / 莱财AI顾问+Agent检测台", "size": 11, "color": "FFFFFF", "space_after": 4},
            {"text": "• B 端（确定性数据层与Wiki）：四值状态机(S004断报熔断) + 两层逐指标可比准入 + 门店中位数ROI + Supabase 4张表与1536维向量Wiki", "size": 11, "color": "FFFFFF", "space_after": 4},
            {"text": "• C 端（LangGraph 七层智能体）：7节点状态图 + KV Cache六铁律 + 三层记忆指代消解 + 双向护栏0幻觉 + IoT主动监控Loop(站内/Webhook/QQ邮箱)", "size": 11, "color": "FFFFFF"},
        ],
    )

    # 右侧嵌入 2 张高清概念图
    img1 = ROOT / "output" / "imagegen" / "01-paper-navy.png"
    img2 = ROOT / "output" / "imagegen" / "03-ivory-terracotta-v2.png"
    rels_s1: list[tuple[str, Path]] = []
    if img1.exists() and img2.exists():
        sb1.add_rect(1120, 162, 724, 405, fill_hex="FFFFFF", line_hex="DCD6C8")
        sb1.add_textbox(1134, 168, 696, 28, [{"text": "📊 界面实景 I：全局经营驾驶舱与四值风险态势", "size": 11, "bold": True, "color": "1E3A5F"}])
        sb1.add_picture("rIdP1Img1", 1134, 198, 696, 356)

        sb1.add_rect(1120, 588, 724, 405, fill_hex="FFFFFF", line_hex="DCD6C8")
        sb1.add_textbox(1134, 594, 696, 28, [{"text": "🤖 界面实景 II：智能审计、同城对标与行动卡派发", "size": 11, "bold": True, "color": "C84B31"}])
        sb1.add_picture("rIdP1Img2", 1134, 624, 696, 356)
        rels_s1 = [("rIdP1Img1", img1), ("rIdP1Img2", img2)]

    slides_data.append((sb1.to_slide_xml(), rels_s1))

    # ==================== P2: 应用场景与现实痛点 ====================
    sb2 = ShapeBuilder()
    add_common_frame(
        sb2,
        "SCENARIOS & PAIN POINTS // 02 · 五大高频场景与三大现实痛点",
        "扎根无人零售高频运营场景 · 终结“看图猜原因、AI 乱算账、分析无闭环”",
        "以长春 5 大城区（朝阳/南关/宽城/二道/绿园）、42 台智能零售柜与 21 家参照门店×42天日经营数据为真实蓝本",
        "00:12 - 00:30 (18秒 · P2/7)",
        "莱森购 Retail Intelligence Agent  |  P2 · 应用场景与现实痛点",
        "痛点决定架构：每一个痛点都对应莱森购的一项硬核工程约束（四值规则引擎、白名单工具、主动监控与复核状态机）",
    )
    sb2.add_rect(76, 162, 1768, 130, fill_hex="142030", line_hex="1E3A5F")
    sb2.add_textbox(
        96,
        172,
        1728,
        110,
        [
            {"text": "五大核心业务应用场景（5 Core Business Scenarios）", "size": 11, "bold": True, "color": "FCD34D", "space_after": 6},
            {
                "text": "① 全域经营巡检与 GIS 风险地图（¥105.4万销额 / ¥21.8万利润 / 42台设备 / 95.2%在线率）   |   ② 门店异动诊断与同城对标（A店/S001 退款率 7.0% vs 同城中位 2.1%，订单跌 31%）",
                "size": 11.5,
                "bold": True,
                "color": "FFFFFF",
                "space_after": 4,
            },
            {
                "text": "③ 新区选址四维评分与 ROI 测算（朝阳区 86.5分/8.4月回本 vs 南关区 71.0分/缺租金返回 null）   |   ④ 7×24h 设备心跳离线主动巡检   |   ⑤ 整改派单与下一周期指标复核",
                "size": 11.5,
                "bold": True,
                "color": "93C5FD",
            },
        ],
    )
    add_bullet_card_xml(
        sb2,
        76,
        312,
        568,
        682,
        "PAIN POINT 01 // 传统 BI 报表的局限",
        "只给图表不给归因 · 聚合掩盖斜坡与断报假阴性",
        [
            "跨表人肉排查耗时耗力：面对 20+ 门店与 40+ 智能柜，运营需在多张表间手工关联销售额、订单量、客单价与退款率。",
            "周期平均值掩盖恶化斜坡：传统周报只看汇总均值，完全掩盖了 S001 门店连续 3 天加速下滑的日趋势斜率。",
            "字段断报导致致命“假阴性”：当 S004 门店自 10月6日起退款字段缺失（NULL 占比 33%），传统 BI 常将其当作 0 异常，漏掉高危故障。",
            "容易误伤单店店长：不区分“整个城区受天气/停电同步下滑（区域性波动）”与“单店自身经营恶化”。",
        ],
        top_hex="C84B31",
        footer_text="核心症结：只有静态数字，没有双因子拆解与数据完整性防呆",
        footer_bg="FDF2F0",
        footer_clr="C84B31",
    )
    add_bullet_card_xml(
        sb2,
        676,
        312,
        568,
        682,
        "PAIN POINT 02 // 通用大模型 / Text-to-SQL 的隐患",
        "AI 自由写 SQL 算错口径 · 样本不足强行幻觉定责",
        [
            "口径失真与除零错误：LLM 极易直接对每日比率求平均（AVG(daily_rate)），而非先聚合分子分母（SUM(refunds)/NULLIF(SUM(orders),0)）。",
            "小样本与缺字段强行编造：当可比门店少于 3 家，或南关区缺失长租成本（fixed_monthly_rent = null）时，通用 AI 仍会编造回本周期。",
            "武断归因与词汇越界：仅凭单一指标波动就咬定“店长舞弊”或“冷链损坏”，缺乏同城基准（Peer Median）与多规则交叉印证。",
            "安全与注入风险：直接放开 SQL 生成极易遭遇 Prompt 注入（如越权查询、篡改规则阈值或直接触发外部写操作）。",
        ],
        top_hex="D97706",
        footer_text="核心症结：把大模型当计算器，缺乏领域契约与输出数值白名单校验",
        footer_bg="FEF7EA",
        footer_clr="D97706",
    )
    add_bullet_card_xml(
        sb2,
        1276,
        312,
        568,
        682,
        "PAIN POINT 03 // 问答与工单系统割裂",
        "被动等待提问 · 聊完即止无派单、无升级、无复核",
        [
            "设备掉线无人主动盯防：传统 AI 必须等运营主动提问才响应；半夜智能柜心跳离线若无人察觉，将直接造成冰品化冻与客诉。",
            "建议沦为空话、缺乏四要素：只输出“建议加强退款管理”，没有明确执行动作、负责角色（Owner）、时限（Due）与复核目标。",
            "无人工确认护栏与幂等保护：要么无法落地建单，要么失控重复建单，缺乏从建议草案（decisionProposal）到正式任务的审批关卡。",
            "缺乏下一周期效果复核：派单后不知是否有效，无法根据下一周期 refund_rate 改善情况自动关闭（closed）或升级（escalated）。",
        ],
        top_hex="1E3A5F",
        footer_text="核心症结：停留在“聊天问答”，未打通主动监控与复核闭环",
        footer_bg="EFF4FA",
        footer_clr="1E3A5F",
    )
    slides_data.append((sb2.to_slide_xml(), []))

    # ==================== P3: 与传统方案的核心差异 ====================
    sb3 = ShapeBuilder()
    add_common_frame(
        sb3,
        "KEY DIFFERENTIATORS // 03 · 为什么我们和传统 BI / 通用大模型完全不同？",
        "核心哲学：确定性引擎做“后厨”算准事实，受控 Agent 做“服务员”编排与表达",
        "A（前端五视图）/ B（确定性数据与规则层）/ C（LangGraph 智能体与 API）基于冻结契约 API Contract v0.1 并行解耦协作",
        "00:30 - 00:50 (20秒 · P3/7)",
        "莱森购 Retail Intelligence Agent  |  P3 · 核心差异化对比",
        "不是“给大模型接个数据库”，而是用冻结契约、规则状态机、KV Cache 六铁律、安全护栏与主动闭环重塑企业级 Agent 标准",
    )
    metaphors = [
        ("1. 标准化后厨 (B层确定性引擎)", "先SUM后算比率、中位数ROI、unavailable→insufficient→possible→none四值序", "1E3A5F"),
        ("2. 受控服务员 (C层7工具+双向护栏)", "禁写SQL/禁改阈值，collectAllowedNumbers逐字核对证据池，100%零数值幻觉", "C84B31"),
        ("3. 高性能上下文 (KV Cache六铁律+三层记忆)", "静态前缀deepFreeze、Append-Only、SHA-256压缩复用、跨轮次实体槽指代消解", "5B4B8A"),
        ("4. 全天候巡检员 (主动监控+人工复核)", "离线5min告警唤醒Agent审计、15min升级；人工确认建单并按周期复核关闭/升级", "1F6F54"),
    ]
    for i, (mt, md, mc) in enumerate(metaphors):
        mx = 76 + i * 446
        sb3.add_rect(mx, 162, 430, 92, fill_hex="FFFFFF", line_hex="DCD6C8")
        sb3.add_rect(mx, 162, 6, 92, fill_hex=mc, line_hex=None)
        sb3.add_textbox(
            mx + 14,
            170,
            406,
            76,
            [
                {"text": mt, "size": 11.5, "bold": True, "color": mc, "space_after": 3},
                {"text": md, "size": 10.2, "bold": False, "color": "3E4E63"},
            ],
        )

    col_x = [76, 326, 736, 1186]
    col_w = [250, 410, 450, 658]
    headers = [
        "核心对比维度",
        "传统 BI 报表系统",
        "传统通用 AI (Text-to-SQL)",
        "✦ 莱森购 Retail Intelligence Agent（本项目）",
    ]
    for c in range(4):
        is_hl = c == 3
        sb3.add_rect(col_x[c], 270, col_w[c], 54, fill_hex="1E3A5F" if is_hl else "142030", line_hex="DCD6C8")
        sb3.add_textbox(
            col_x[c] + 12,
            276,
            col_w[c] - 24,
            42,
            [{"text": headers[c], "size": 12, "bold": True, "color": "FCD34D" if is_hl else "FFFFFF"}],
            anchor="ctr",
        )

    rows_s3 = [
        (
            "1. 口径与计算准确性",
            "静态 SQL 聚合，易掩盖斜坡下滑，无双因子自动拆解",
            "LLM 自由写 SQL 易平均每日比率、算错口径，结果不可复现",
            "Contract-First 确定性计算：先 SUM 再算比率，区域利润/回本取门店中位数，0 算账幻觉",
        ),
        (
            "2. 数据缺失与可比防呆",
            "字段断报常显示为 0，造成“无异常”的致命假阴性",
            "样本不足或缺成本时仍强行编造回本周期与确定性根因",
            "S004 缺失熔断 + 两层逐指标可比准入：少于 3 家返回 insufficient，缺租金返回 null",
        ),
        (
            "3. 安全边界与防幻觉",
            "无自然语言交互，仅支持固定筛选器查询",
            "易受 Prompt 注入越权，总结文本常夹带未查询的幻觉数字",
            "7 白名单工具 + 双向护栏：拦截 SQL 注入/改阈值，collectAllowedNumbers 零幻觉校验",
        ),
        (
            "4. 记忆与上下文工程",
            "无上下文记忆，每次筛选互不关联",
            "系统提示词插值破坏缓存，用 slice(-N) 截断丢失历史",
            "KV Cache 六铁律 + 三层记忆：静态前缀冻结、SHA-256 压缩复用、支持“帮它派单”指代消解",
        ),
        (
            "5. 触发方式与执行闭环",
            "纯被动看图，无任务派发与效果追踪",
            "被动一问一答，聊完即止，无 SLA 升级与复核机制",
            "主动监控 Loop + 人机复核闭环：心跳离线唤醒 Agent 审计，人工确认派单并按周期复核关闭/升级",
        ),
    ]
    for r_idx, row_vals in enumerate(rows_s3):
        ry = 324 + r_idx * 134
        rh = 134
        for c in range(4):
            is_hl = c == 3
            sb3.add_rect(
                col_x[c],
                ry,
                col_w[c],
                rh,
                fill_hex="F3F8F5" if is_hl else "FFFFFF",
                line_hex="1F6F54" if is_hl else "DCD6C8",
                line_pt=1.5 if is_hl else 1.0,
            )
            txt_color = "142030" if c in (0, 3) else ("C84B31" if c == 2 else "3E4E63")
            sb3.add_textbox(
                col_x[c] + 12,
                ry + 8,
                col_w[c] - 24,
                rh - 16,
                [{"text": row_vals[c], "size": 11.5, "bold": c in (0, 3), "color": txt_color}],
                anchor="ctr",
            )
    slides_data.append((sb3.to_slide_xml(), []))

    # ==================== P4: 核心重点（一）A+B 端 ====================
    sb4 = ShapeBuilder()
    add_common_frame(
        sb4,
        "CORE ARCHITECTURE PART 1 // 04 · 五位一体前端工作台 + 确定性数据层与结构化 Wiki（A & B 层）",
        "五位一体交互工作台 × 四值规则防呆引擎 × Supabase 结构化知识 Wiki",
        "所有金额与数量先聚合再算比率，每个指标、排名与异常结论均携带 evidence_ids、data_version 与 trace_id",
        "00:50 - 01:10 (20秒 · P4/7)",
        "莱森购 Retail Intelligence Agent  |  P4 · 核心重点（一）：A & B 层",
        "核心代码：src/services/{metric_service,rule_engine,benchmark_service,region_score}.ts · data_layer/{domain_services,rule_engine,wiki}.py",
    )
    add_bullet_card_xml(
        sb4,
        76,
        165,
        868,
        830,
        "FRONTEND & LOCATION SCORING // 五大共享视图与四维选址模型",
        "1. 五页共享同一数据契约 + 区域四维加权 ROI 测算",
        [
            "真实核心业务指标：长春 7日总销售额 ¥1,054,000（总利润 ¥218,000）；A店/S001 退款率 7.0% vs 同城中位数 2.1%；朝阳区评分 86.5分 / 8.4个月回本（南关区缺长租成本强制返回 null）。",
            "五大核心页面 + 双顾问入口：① 经营驾驶舱（含 21店×42天日销售斜坡序列与长春 Leaflet GIS 风险地图） ② 智能审计与同城对标 ③ 区域投放决策 ④ 经营行动中心 ⑤ “莱财”AI 经营顾问气泡 & Agent 检测工作台（实时检视规划合同、KV Cache 与 API 健康度）。",
            "销售额双因子拆解：强制将销售额波动拆解为 order_change_pct（订单数）与 aov_change_pct（客单价），避免把客流规模波动误判为客单效率问题。",
            "区域四维评分与门店中位数 ROI 模型：按 Score = 0.35×需求 + 0.25×竞争 + 0.25×毛利 - 0.15×成本 归一化评分；区域月利润与回本周期取区域内门店中位数（防止沦为门店数量比较）。",
        ],
        top_hex="1E3A5F",
        footer_text="前端零私算原则：React 前端只渲染后端契约返回的数值、单位、证据与状态标签，绝不在前端复制公式或篡改风险等级。",
        footer_bg="EFF4FA",
        footer_clr="1E3A5F",
    )
    add_bullet_card_xml(
        sb4,
        976,
        165,
        868,
        830,
        "DETERMINISTIC DATA LAYER & WIKI // 规则状态机与三路径数据层",
        "2. 四值防呆状态机 + 两层可比准入 + Supabase 4表 Wiki",
        [
            "四值规则状态机严格优先级：unavailable（有效天<5 或空值>20%）→ insufficient（可比店<3 或仅命中1条规则）→ possible（命中≥2条且样本充足）→ none（数据完整且无异常），彻底杜绝假阴性。",
            "S004 缺失熔断与“两层逐指标可比准入”：S004 自 10月6日起退款字段断报（空值率 33% > 20%），单店审计严格触发 unavailable 熔断保护；但在同区对标时按逐指标准入保留其完整的销售/订单数据，防止朝阳区可比池跌破 min_peers = 3。",
            "防误伤单店规则：当同区域 ≥40% 门店同步异常且离散度低时，自动标记为“区域性波动”，严禁直接归咎于单店店长。",
            "三路径无缝切换 + Supabase 4张核心表：支持【前端内存夹具 / Python 离线服务 (--offline) / Supabase PostgreSQL】三路径；云端内置 store_operations_daily、region_market_inputs、tasks_and_traces 及 knowledge_wiki（承载 semantic_rule、sop_playbook、region_profile、historical_case 及 1536 维向量列）。",
        ],
        top_hex="1F6F54",
        footer_text="确定性验证保障：提供 python tools/verify_local.py 与 npm run validate:contracts 自动化校验全量指标与契约 Fixture。",
        footer_bg="EEF7F4",
        footer_clr="1F6F54",
    )
    slides_data.append((sb4.to_slide_xml(), []))

    # ==================== P5: 核心重点（二）C 端智能体内核 ====================
    sb5 = ShapeBuilder()
    add_common_frame(
        sb5,
        "CORE ARCHITECTURE PART 2 // 05 · LangGraph 七层编排 + KV Cache 六大铁律 + 三层记忆与双向护栏（C 层）",
        "LangGraph 7 节点受控状态图 × KV Cache 工程铁律 × 100% 零数值幻觉",
        "严禁开放式裸答（disallowOpenEndedDirectAnswer = true），无 API Key 时自动启用确定性规划与模板兜底，保障离线 100% 可用",
        "01:10 - 01:30 (20秒 · P5/7)",
        "莱森购 Retail Intelligence Agent  |  P5 · 核心重点（二）：C 层智能体内核",
        "核心代码：src/agent/{definition,pattern,mechanisms,safety,orchestrator}.js · src/agent/components/{contextBuilder,memoryManager}.js",
    )
    add_bullet_card_xml(
        sb5,
        76,
        165,
        568,
        830,
        "7-LAYER & 7-NODE STATEGRAPH // 架构解耦与状态机",
        "1. 七层架构与有界重规划状态图",
        [
            "七层清晰解耦：① 定义层 definition.js ② 模式层 pattern.js ③ 组件层 components/* ④ 机制层 mechanisms.js ⑤ 安全层 safety.js ⑥ 编排层 orchestrator.js ⑦ 工程层 api.js & traceLogger.js。",
            "7 节点受控 StateGraph：InputGuard → Planner → ToolExecutor ⇄ EvidenceVerifier (Bounded Re-plan 最多 1 次重规划补齐同区对标) → Normal/DegradedSynthesizer → OutputGuard。",
            "7 个白名单工具（4 读 3 写）：读工具（get_dashboard / run_audit / compare_regions / estimate_region_roi）按拓扑序执行；写工具（create_task / verify_task / write_report）必须具备用户显式授权关键词，否则降级为待确认草案。",
            "双模高可用容灾：配置 LLM API Key 时走原生 Tool Calling；断网或未配 Key 时自动无缝降级至确定性规则规划器。",
        ],
        top_hex="1E3A5F",
        footer_text="全链路可回放：每次调用生成唯一 traceId，完整记录 toolCalls、evidenceIds 与 latencyMs。",
        footer_bg="EFF4FA",
        footer_clr="1E3A5F",
    )
    add_bullet_card_xml(
        sb5,
        676,
        165,
        568,
        830,
        "KV CACHE & 3-TIER MEMORY // 上下文工程与记忆架构",
        "2. KV Cache 六铁律 + 三层记忆体系",
        [
            "铁律 1-2（静态前缀零插值 & Schema 冻结）：STATIC_SYSTEM_MESSAGE 与 7 个工具 JSON Schema 启动时 Object.freeze，严禁在系统提示词中拼接时间戳或动态会话变量。",
            "铁律 3-4（Append-Only & 标准四角色）：严格遵循 system -> user -> assistant(tool_calls) -> tool(tool_call_id) 追加模型，绝不原地篡改历史消息。",
            "铁律 5-6（SHA-256 持久化摘要压缩 & 命中追踪）：严禁使用 .slice(-N) 滑动窗口截断（每轮改变首条消息会彻底击穿 KV Cache）；超阈值时执行带 SHA-256 哈希缓存的 compactMessagesIfNeeded，并实时监控 cached_tokens。",
            "LangGraph 三层记忆与指代消解：① 工作记忆 AgentStateAnnotation ② 线程短期记忆 MemorySaver + 实体槽位（lastDeviceId/lastRegionIds/lastTaskId）③ 跨会话长期记忆 InMemoryStore，完美支持“那帮它创建一个整改任务”跨轮次指代。",
        ],
        top_hex="5B4B8A",
        footer_text="工程收益：大幅降低多轮对话首字延迟（TTFT）与 Token 成本，同时保持上下文连贯。",
        footer_bg="F3F0FA",
        footer_clr="5B4B8A",
    )
    add_bullet_card_xml(
        sb5,
        1276,
        165,
        568,
        830,
        "BIDIRECTIONAL GUARDRAILS // 安全护栏与业务脱敏",
        "3. 双向安全护栏 + 0 幻觉数值校验",
        [
            "输入护栏（InputGuard）：正则拦截 SQL 注入（DROP TABLE）、Prompt 越权（ignore previous instructions）、系统提示词刺探、篡改规则阈值及自动改价/自动打款等高危指令。",
            "输出数值白名单校验（collectAllowedNumbers）：递归提取当轮工具返回 JSON 中的所有合法数字与百分比；若 LLM 总结中出现任何不在白名单内的未授权数字，立即拦截并回退至确定性证据模板，实现 100% 零数值幻觉。",
            "证据完备性校验（EvidenceVerifier）：当可比门店不足 3 家或关键字段缺失时，强制路由至 DegradedSynthesizer，严禁输出确定性根因或武断指责词汇。",
            "全业务化脱敏与思考流可视化：对最终用户严禁暴露内部函数名/字段名，同时输出类 Antigravity 风格的 thinkingSteps 折叠思考链路。",
        ],
        top_hex="C84B31",
        footer_text="安全验证：npm run test:agent 全自动通过单轮、多轮指代、越权拦截与数值防幻觉测试。",
        footer_bg="FDF2F0",
        footer_clr="C84B31",
    )
    slides_data.append((sb5.to_slide_xml(), []))

    # ==================== P6: 核心重点（三）双闭环引擎 ====================
    sb6 = ShapeBuilder()
    add_common_frame(
        sb6,
        "CORE ARCHITECTURE PART 3 // 06 · 人机协同任务复核闭环 + IoT 主动监控告警闭环（Dual Closed-Loop Engines）",
        "不止于“问答”：把每一次异常诊断转化为可追责、可升级、可复核的闭环",
        "一条链路面向“运营决策执行与周期复核”，一条链路面向“7×24h 设备心跳监控与自动唤醒审计”",
        "01:30 - 01:48 (18秒 · P6/7)",
        "莱森购 Retail Intelligence Agent  |  P6 · 核心重点（三）：双闭环落地引擎",
        "核心代码：src/agent/monitorLoop.js · src/AgentLoopPanel.jsx · scripts/verify-monitor-loop.mjs",
    )
    add_bullet_card_xml(
        sb6,
        76,
        165,
        868,
        830,
        "HUMAN-IN-THE-LOOP ACTION VERIFICATION // 经营行动与复核闭环",
        "1. 审批卡确认 → 幂等建单 → 下一周期指标复核",
        [
            "状态流转：decisionProposal (待确认草案) → open → assigned → investigating → verifying → closed (达标关闭) / escalated (未达标升级)。",
            "人机协同审批卡（Human-in-the-Loop）：当用户未显式下达写指令时，Agent 自动生成包含同行对标摘要（peerSummary）、预期挽回收益（expectedImpact）与紧急度的待确认行动卡，需人工点击“确认转化”后才真正落库。",
            "幂等键防重（Idempotency Key）：POST /api/v1/tasks/from-recommendation 通过 idempotencyKey 保证同一建议绝不重复建单，自动绑定 assignee、dueAt 与 evidenceIds。",
            "下一周期自动复核（verify_task）：以朝阳 A 店为例，复核目标设定为“下一周期 refund_rate 回落至同城中位数 + 2.0% 以内”；达标自动流转为 closed，未达标自动触发 escalated 升级督办。",
        ],
        top_hex="1F6F54",
        footer_text="真实闭环示例：task_001（抽查 A 店最近 20 笔退款订单）→ 负责人：长春朝阳区域经理 → 期限：24h → 复核指标：refund_rate",
        footer_bg="EEF7F4",
        footer_clr="1F6F54",
    )
    add_bullet_card_xml(
        sb6,
        976,
        165,
        868,
        830,
        "PROACTIVE IOT MONITOR LOOP // 设备心跳主动监控与自唤醒审计",
        "2. 无需人工提问：设备离线自动唤醒 Agent 预审计",
        [
            "状态流转：detected (2min超时去重) → alerted (5min通知+唤醒Agent) → acknowledged (负责人确认) → escalated (15min未确认升级) → resolved (设备恢复结案)。",
            "去重检测与分级 SLA 升级：后台独立运行心跳巡检，按 device-offline:{deviceId} 严格去重；离线满 5 分钟发送首次负责人通知（alerted），满 15 分钟仍未确认自动发送升级通知（escalated）。",
            "无人工干预自动唤醒 Agent 审计：进入 alerted 阶段后，监控引擎自动异步调用 Agent 审计链路（runAgentTurn），将诊断摘要保存至告警的 agentSummary、agentFindings 与 agentTraceId 中。",
            "三通道异步通知 + 状态持久化恢复：内置【站内通知列表 + 外部 Webhook JSON 推送 + QQ 邮箱 SSL SMTP (smtp.qq.com:465)】三通道适配器；状态实时写入 tmp/agent-monitor-state.json，服务重启零丢失。",
        ],
        top_hex="C84B31",
        footer_text="回归测试保障：npm run test:monitor-loop 全面覆盖去重、5min通知、15min升级、确认、恢复与重启持久化。",
        footer_bg="FDF2F0",
        footer_clr="C84B31",
    )
    slides_data.append((sb6.to_slide_xml(), []))

    # ==================== P7: 未来扩展愿景 ====================
    sb7 = ShapeBuilder()
    add_common_frame(
        sb7,
        "FUTURE EXPANSION VISION // 07 · 三阶段演进蓝图（Roadmap & Scalability）",
        "从“契约驱动的经营审计平台”演进为“自进化的全域无人零售经营大脑”",
        "当前模块化单体与冻结契约已预留完整的 OIDC 租户上下文、外部数据适配器与 pgvector(1536) 向量检索接口",
        "01:48 - 02:00 (12秒 · P7/7)",
        "莱森购 Retail Intelligence Agent  |  P7 · 未来扩展愿景（2分钟路演完毕）",
        "一键验证命令：npm run validate:contracts | npm run test:agent | npm run test:monitor-loop | python tools/verify_local.py",
    )
    add_bullet_card_xml(
        sb7,
        76,
        165,
        568,
        665,
        "PHASE 01 · 生产级多租户底座 (1-3个月)",
        "连接真实世界：实时数仓、边缘网关与多租户安全",
        [
            "真实 IoT 边缘网关与实时数仓接入：将主动监控入口对接鉴权后的智能货柜 MQTT/边缘网关，数据层平滑切换至企业 ERP/POS 实时数仓。",
            "OIDC 认证与 PostgreSQL RLS 多租户隔离：落地 TECHNICAL_ARCHITECTURE.md 规划的 OIDC/OAuth2 登录，由后端注入 tenant_id、user_id 与区域权限，开启行级安全策略。",
            "Redis 分布式幂等锁与企微/飞书卡片：将进程内幂等控制升级为 Redis 分布式锁，Webhook 适配器对接企业微信与飞书交互式审批卡片。",
        ],
        top_hex="1E3A5F",
        footer_text="阶段里程碑：零代码改动前端契约，完成从本地/云端 Demo 到千台智能柜生产环境上线",
        footer_bg="EFF4FA",
        footer_clr="1E3A5F",
    )
    add_bullet_card_xml(
        sb7,
        676,
        165,
        568,
        665,
        "PHASE 02 · 多模态与全域经营扩维 (3-6个月)",
        "看得更全：视觉货柜巡检 + 库存/会员/营销/人效",
        [
            "边缘多模态视觉审计（Vision Audit）：在数据契约稳定基础上，接入智能柜摄像头视觉模型，自动识别货道缺货、陈列错放、冷链结霜与异常开门。",
            "四大业务域指标横向扩展：在销售与退款之上，新增库存周转与缺货损失、会员复购分层、促销活动弹性以及补货员路径与人效对标工具。",
            "外部时空与竞品适配器：接入高德/百度 POI 客流热力、天气突变与周边竞品点位动态接口，提升区域选址 ROI 模型的时空灵敏度。",
        ],
        top_hex="C84B31",
        footer_text="阶段里程碑：从“事后交易数据审计”扩展为“交易 + 库存 + 视觉 + 时空”的全维实时感知",
        footer_bg="FDF2F0",
        footer_clr="C84B31",
    )
    add_bullet_card_xml(
        sb7,
        1276,
        165,
        568,
        665,
        "PHASE 03 · 向量检索与自进化大脑 (6-12个月)",
        "越用越准：pgvector 经验召回 + 复核结果强化调优",
        [
            "全面激活 pgvector(1536) 混合检索：启用 knowledge_wiki 表已预留的 embedding vector(1536) 列，将每次 closed 的成功案件沉淀为向量化历史经验自动召回。",
            "基于复核结果的策略权重闭环校准：利用 verify_task 积累的“行动建议 → 下一周期真实改善幅度”闭环数据，自动校准风险排序权重与 ROI 参数。",
            "受契约约束的多 Agent 协同网络：演进为“巡检审计 Agent + 供应链补货 Agent + 动态定价与选址 Agent”多智能体协同。",
        ],
        top_hex="1F6F54",
        footer_text="阶段里程碑：构建“每次复核都在让系统更聪明”的无人零售经营自进化飞轮",
        footer_bg="EEF7F4",
        footer_clr="1F6F54",
    )
    sb7.add_rect(76, 850, 1768, 145, fill_hex="142030", line_hex="1E3A5F")
    sb7.add_textbox(
        104,
        866,
        1712,
        115,
        [
            {
                "text": "🎯 莱森购 Retail Intelligence Agent · 让每一次无人零售经营决策都有据可查、有果必验",
                "size": 17,
                "bold": True,
                "color": "FFFFFF",
                "space_after": 6,
            },
            {
                "text": "Contract-First 确定性底座 × 四值防呆规则引擎 × LangGraph 七层受控编排 × KV Cache 六铁律 × 主动监控与人工复核双闭环     |     THANK YOU // Q&A",
                "size": 12.5,
                "bold": True,
                "color": "34D399",
            },
        ],
        anchor="ctr",
    )
    slides_data.append((sb7.to_slide_xml(), []))

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

        zf.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""",
        )

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
      <a:dk1><a:srgbClr val="142030"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E3A5F"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F3EC"/></a:lt2>
      <a:accent1><a:srgbClr val="1E3A5F"/></a:accent1>
      <a:accent2><a:srgbClr val="C84B31"/></a:accent2>
      <a:accent3><a:srgbClr val="1F6F54"/></a:accent3>
      <a:accent4><a:srgbClr val="D97706"/></a:accent4>
      <a:accent5><a:srgbClr val="5B4B8A"/></a:accent5>
      <a:accent6><a:srgbClr val="3E4E63"/></a:accent6>
      <a:hlink><a:srgbClr val="1E3A5F"/></a:hlink>
      <a:folHlink><a:srgbClr val="1E3A5F"/></a:folHlink>
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
    write_pptx_package(PPTX_EDITABLE_PATH, editable_slides, SPEAKER_NOTES)
    print(f"[OK] Generated Native Editable PPTX: {PPTX_EDITABLE_PATH}")

    visual_slides = build_visual_slides(png_paths)
    write_pptx_package(PPTX_VISUAL_PATH, visual_slides, SPEAKER_NOTES)
    print(f"[OK] Generated High-Fidelity Visual PPTX: {PPTX_VISUAL_PATH}")


if __name__ == "__main__":
    main()
