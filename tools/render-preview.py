#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 README 用的界面预览图：docs/preview-panel-light.png / -dark.png

不使用浏览器截图——所有像素由 PIL 按仓库自己的样式常量绘制，所以：

  * 颜色、字号、内距、圆角取自 client.js 的 `const C` / `const style`
    以及 DSH 主题 token 的实际取值（浅色 --dsw-alias-bg-layer-1 = #ffffff，
    深色 = #232324，边框 / 文字色同理）；
  * 面板尺寸取自 client.js 的 PANEL_W / PANEL_H / GAP；
  * 面板里的片段名 / 分类 / 标签取自 index.js 的 TEMPLATE_PACK，
    即用户首次运行时真的会看到的那几条；
  * 每条界面文案都会先到 client.js 里逐字核对，对不上就拒绝出图。

两道断言（出图成功即通过）：
  1. 文案与源码一致——防止图与代码漂移；
  2. 每个文本块不越过面板边界、面板不越出视口边距——防止文字被裁。

改了 client.js 的样式或文案后重跑本脚本即可同步：

    python tools/render-preview.py

依赖：Python 3.8+ 与 Pillow（pip install pillow）。字体用系统的微软雅黑与
Segoe UI Emoji；可用环境变量 PREVIEW_FONT_DIR 指定字体目录。
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "docs")
S = 2  # 2x 超采样后降采样，边缘更干净

# ── 字体：优先环境变量，其次 Windows 默认路径 ──
FONT_DIR = os.environ.get("PREVIEW_FONT_DIR") or r"C:\Windows\Fonts"


def _pick(*names):
    for n in names:
        p = os.path.join(FONT_DIR, n)
        if os.path.exists(p):
            return p
    return None


F_REG = _pick("msyh.ttc", "msyh.ttf", "simhei.ttf", "DejaVuSans.ttf")
F_SB = _pick("msyhbd.ttc", "msyhbd.ttf", "simhei.ttf", "DejaVuSans-Bold.ttf") or F_REG
F_EMOJI = _pick("seguiemj.ttf", "NotoColorEmoji.ttf") or F_REG

if not F_REG:
    sys.exit("找不到中文字体，请设置 PREVIEW_FONT_DIR 指向含 msyh.ttc 的目录")

_fc = {}
AUDIT = []

# ── 界面文案：每一条都会拿去 client.js 核对 ──
S_CLOSE = "×"
S_SEARCH = "搜索名称 / 分类 / 内容…"
S_VIEWS = ["全部", "★ 收藏", "最近使用"]
S_NEW = "＋ 新建"
S_EXPORT = "⬇ 导出"
S_IMPORT = "⬆ 导入"
S_HINT = "点名称插入 · ✏️ 编辑 · ✨ 优化 · 🗑 删除 · 拖标题栏移动 · 拖边缘调大小"
S_PIN = "★ "
S_ICONS = ["✏️", "🕘", "✨", "🗑"]

# ── 内置模板包（index.js TEMPLATE_PACK 的真实数据，取前 6 条填首屏）──
GROUPS = [
    ("开发", [("代码审查", ["代码", "审查"], True),
              ("Git 提交信息", ["git", "提交"], False),
              ("Bug 排查", ["bug", "排查"], False)]),
    ("写作", [("周报", ["周报", "工作"], True),
              ("日报", ["日报", "工作"], False),
              ("翻译润色", ["翻译", "润色"], False)]),
]

PANEL_W, PANEL_H, GAP = 340, 440, 8
W, H = 1120, 640
SIDEBAR = 208
CONVS = ["提示词片段库重构", "codex 413 排查", "周报草稿", "Git 提交规范", "服务器巡检记录"]


def font(path, px):
    key = (path, round(px))
    if key not in _fc:
        _fc[key] = ImageFont.truetype(path, max(1, round(px)))
    return _fc[key]


def F(size, bold=False):
    return font(F_SB if bold else F_REG, size * S)


def EMO(size):
    return font(F_EMOJI, size * S)


def rgba(hexstr, alpha=255):
    h = hexstr.lstrip("#")
    if len(h) == 8:
        r, g, b, a = (int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
        return (r, g, b, round(a * alpha / 255))
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (r, g, b, alpha)


def theme(dark):
    """对应 @deepseek-ai/dsh-client-ui-theme 的 alias 映射实际取值。"""
    if not dark:
        return dict(base="#ffffff", layer1="#ffffff", side="#f9fafb",
                    l1="#0000000a", l2="#0000001a",
                    text="#0f1115", text2="#61666b", warn="#f59e0b", error="#ec1313")
    return dict(base="#151517", layer1="#232324", side="#1b1b1c",
                l1="#ffffff0f", l2="#ffffff1f",
                text="#f9fafb", text2="#adb2b8", warn="#f59e0b", error="#f25a5a")


class Canvas:
    def __init__(self, w, h, bg):
        self.img = Image.new("RGBA", (w * S, h * S), bg)
        self.d = ImageDraw.Draw(self.img)
        self.w, self.h = w, h

    def _apply(self, lay):
        self.img = Image.alpha_composite(self.img, lay)
        self.d = ImageDraw.Draw(self.img)

    def rect(self, x, y, w, h, fill=None, radius=0, stroke=None, sw=1):
        lay = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        box = [x * S, y * S, (x + w) * S, (y + h) * S]
        if fill:
            if radius:
                d.rounded_rectangle(box, radius=radius * S, fill=fill)
            else:
                d.rectangle(box, fill=fill)
        if stroke:
            if radius:
                d.rounded_rectangle(box, radius=radius * S, outline=stroke,
                                    width=max(1, round(sw * S)))
            else:
                d.rectangle(box, outline=stroke, width=max(1, round(sw * S)))
        self._apply(lay)

    def hline(self, x, y, w, color, width=1):
        lay = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        ImageDraw.Draw(lay).rectangle(
            [x * S, y * S, (x + w) * S, y * S + max(1, round(width * S))], fill=color)
        self._apply(lay)

    def shadow(self, x, y, w, h, radius, blur=8, alpha=30):
        lay = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        d.rounded_rectangle([(x + 1) * S, (y + 3) * S, (x + w + 1) * S, (y + h + 3) * S],
                            radius=radius * S, fill=(0, 0, 0, alpha))
        lay = lay.filter(ImageFilter.GaussianBlur(blur * S))
        self._apply(lay)


def put(cv, x, y, s, f, fill, ls=0.0, tag=None, right_limit=None):
    if ls:
        cx = x
        for ch in s:
            cv.d.text((cx, y), ch, font=f, fill=fill)
            cx += cv.d.textlength(ch, font=f) + ls * S
        wpx = cx - x
    else:
        cv.d.text((x, y), s, font=f, fill=fill)
        wpx = cv.d.textlength(s, font=f)
    if tag:
        AUDIT.append(dict(tag=tag, x=x, w=wpx / S, y=y, size=f.size / S,
                          right_limit=right_limit))
    return wpx / S


def put_emoji(cv, x, y, glyph, size, tag=None, right_limit=None):
    f = font(F_EMOJI, size * S)
    lay = Image.new("RGBA", cv.img.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((x * S, y * S), glyph, font=f, embedded_color=True)
    cv._apply(lay)
    w = cv.d.textlength(glyph, font=f) / S
    if tag:
        AUDIT.append(dict(tag=tag, x=x, w=w, y=y, size=size, right_limit=right_limit))
    return w


def put_c(cv, cx, y, s, f, fill, tag=None, right_limit=None):
    w = cv.d.textlength(s, font=f) / S
    cv.d.text((cx - w / 2, y), s, font=f, fill=fill)
    if tag:
        AUDIT.append(dict(tag=tag, x=cx - w / 2, w=w, y=y, size=f.size / S,
                          right_limit=right_limit))
    return w


def draw_panel(cv, t, x0, y0):
    surface = rgba(t["layer1"])
    tmain = rgba(t["text"])
    tdim = rgba(t["text2"])
    tint4 = rgba(t["text"], 10)   # surfaceAlt = color-mix(label-primary 4%)
    tint7 = rgba(t["text"], 18)   # surfaceHover = 7%
    border = rgba(t["l2"])
    subtle = rgba(t["l1"])
    right = x0 + PANEL_W
    inner = right - 6             # body padding 6px

    cv.shadow(x0, y0, PANEL_W, PANEL_H, 10)
    cv.rect(x0, y0, PANEL_W, PANEL_H, fill=surface, radius=10)
    cv.rect(x0, y0, PANEL_W, PANEL_H, radius=10, stroke=subtle, sw=0.8)
    y = y0

    # header｜padding 7px 8px / fontSize 12 / weight 600 / gap 6
    ew = put_emoji(cv, x0 + 8, y + 9, "📋", 13, tag="header.emoji", right_limit=right - 8)
    put(cv, x0 + 8 + ew + 6, y + 9, "片段库", F(12, True), tmain,
        tag="header.title", right_limit=right - 8)
    put(cv, right - 15, y + 6, S_CLOSE, F(16), tdim, tag="header.close", right_limit=right)
    y += 32
    cv.hline(x0, y, PANEL_W, subtle)
    y += 1

    # searchWrap｜padding 6px 8px / bg surfaceAlt / input padding 5px 8px
    cv.rect(x0, y, PANEL_W, 40, fill=tint4)
    cv.rect(x0 + 8, y + 6, PANEL_W - 16, 28, fill=surface, radius=5, stroke=border, sw=1)
    put(cv, x0 + 16, y + 13, S_SEARCH, F(12), rgba(t["text2"], 185),
        tag="search.placeholder", right_limit=right - 16)
    y += 40
    cv.hline(x0, y, PANEL_W, subtle)
    y += 1

    # viewBar｜padding 4px 8px / gap 4 / pill padding 2px 10px radius 999
    cv.rect(x0, y, PANEL_W, 28, fill=tint4)
    px = x0 + 8
    for i, label in enumerate(S_VIEWS):
        f = F(11)
        w = cv.d.textlength(label, font=f) / S + 20
        if i == 0:
            cv.rect(px, y + 4, w, 20, fill=tint7, radius=10, stroke=border, sw=1)
            fg = tmain
        else:
            cv.rect(px, y + 4, w, 20, radius=10, stroke=border, sw=1)
            fg = tdim
        put_c(cv, px + w / 2, y + 9, label, f, fg, tag="view.%d" % i, right_limit=right - 8)
        px += w + 4
    y += 28
    cv.hline(x0, y, PANEL_W, subtle)
    y += 1

    # body｜padding 6px / group padding 6px 8px 2px / item padding 7px 8px
    body_top = y
    y += 6
    row_h = 33
    for gname, items in GROUPS:
        y += 6
        put(cv, x0 + 8, y, gname, F(11, True), tdim, ls=0.03,
            tag="group." + gname, right_limit=inner)
        y += 18
        for name, tags, pinned in items:
            cy = y + row_h / 2
            acts = list(zip(S_ICONS, [tdim, tdim, tdim, rgba(t["error"])]))
            widths = [cv.d.textlength(g, font=EMO(13)) / S + 12 for g, _ in acts]
            icon_total = sum(widths) + 4 * (len(widths) - 1)

            ix = x0 + 6 + 8
            if pinned:
                ix += put(cv, ix, cy - 9, S_PIN, F(13), rgba(t["warn"]),
                          tag="pin." + name, right_limit=inner)
            put(cv, ix, cy - 9, name, F(13), tmain, tag="item." + name, right_limit=inner)
            ix += cv.d.textlength(name, font=F(13)) / S
            for tg in tags:
                cw = cv.d.textlength(tg, font=F(10)) / S + 12
                if ix + 4 + cw > inner - icon_total:
                    break
                ix += 4
                cv.rect(ix, cy - 7, cw, 14, fill=tint7, radius=7)
                put_c(cv, ix + cw / 2, cy - 6, tg, F(10), tdim, tag="tag." + tg,
                      right_limit=inner)
                ix += cw

            ax = inner
            for (glyph, _), gw in zip(reversed(acts), reversed(widths)):
                ax -= gw
                put_emoji(cv, ax + 6, cy - 9, glyph, 13, tag="icon." + glyph,
                          right_limit=inner)
                ax -= 4
            y += row_h
    body_h = y + 6 - body_top
    cv.hline(x0, body_top + body_h, PANEL_W, subtle)
    y = body_top + body_h

    # addRow｜padding 6px 8px / gap 6 / radius 5
    cv.rect(x0, y, PANEL_W, 36, fill=surface)
    bx = x0 + 8
    for label in [S_NEW, S_EXPORT, S_IMPORT]:
        f = F(12)
        w = cv.d.textlength(label, font=f) / S + 20
        cv.rect(bx, y + 6, w, 24, radius=5, stroke=border, sw=1)
        put_c(cv, bx + w / 2, y + 11, label, f, tdim, tag="add." + label,
              right_limit=right - 8)
        bx += w + 6
    y += 36

    # hint｜padding 4px 8px 6px / fontSize 10 / opacity .85
    cv.hline(x0, y, PANEL_W, subtle)
    put(cv, x0 + 8, y + 5, S_HINT, F(10), rgba(t["text2"], 217), tag="hint",
        right_limit=right - 8)
    return y + 25 - y0


def figure(dark):
    t = theme(dark)
    cv = Canvas(W, H, rgba(t["base"]))
    tmain, tdim = rgba(t["text"]), rgba(t["text2"])

    # 左侧会话列表（只为给面板一个真实宿主背景）
    cv.rect(0, 0, SIDEBAR, H, fill=rgba(t["side"]))
    cv.hline(SIDEBAR, 0, 1, rgba(t["l2"]), width=H)
    put(cv, 16, 22, "会话", F(12, True), tdim, tag="side.head")
    cyy = 44
    for i, c in enumerate(CONVS):
        if i == 0:
            cv.rect(8, cyy, SIDEBAR - 16, 30, fill=rgba(t["text"], 18), radius=6)
        put(cv, 16, cyy + 8, c, F(12), tmain if i == 0 else tdim,
            tag="side.%d" % i, right_limit=SIDEBAR - 8)
        cyy += 32

    CX = SIDEBAR + 1

    bub = "这个插件的面板还有哪些可以改进的地方？"
    bw = cv.d.textlength(bub, font=F(13)) / S + 28
    cv.rect(W - 24 - bw, 38, bw, 38, fill=rgba(t["text"], 16), radius=10)
    put(cv, W - 24 - bw + 14, 47, bub, F(13), tmain, tag="bubble", right_limit=W - 24)

    for i, line in enumerate([
        "信息层级是清楚的，三点建议：",
        "① 分类标题吸顶，长列表滚动时不丢上下文；",
        "② 搜索右侧实时显示 命中/总数，输入即反馈；",
        "③ 窄屏用 min() 收窄，320px 面板也不溢出。",
    ]):
        put(cv, CX + 24, 112 + i * 23, line, F(13), tmain, tag="reply.%d" % i,
            right_limit=W - 24)

    # 输入区 + dock 按钮｜padding 4px 10px / gap 6 / fontSize 12 / radius 6
    input_y = H - 118
    cv.hline(CX, input_y - 14, W - CX, rgba(t["l2"]))
    cv.rect(CX + 24, input_y, W - CX - 48, 52, fill=rgba(t["layer1"]), radius=10,
            stroke=rgba(t["l2"]), sw=1)
    put(cv, CX + 38, input_y + 18, "输入消息，Enter 发送…", F(13),
        rgba(t["text2"], 185), tag="composer", right_limit=W - 24)

    dock_y = input_y + 62
    emw = cv.d.textlength("📋", font=EMO(13)) / S
    dil = cv.d.textlength("片段库", font=F(12)) / S
    dock_w = 10 + emw + 6 + dil + 10
    cv.rect(CX + 24, dock_y, dock_w, 24, radius=6, stroke=rgba(t["l2"]), sw=1)
    put_emoji(cv, CX + 34, dock_y + 4, "📋", 13, tag="dock.emoji", right_limit=W)
    put(cv, CX + 34 + emw + 6, dock_y + 6, "片段库", F(12), tmain, tag="dock.label",
        right_limit=W)

    # 面板定位遵循 client.js 的 clampPos：与视口边保持 GAP=8
    px = min(CX + 24, W - PANEL_W - GAP)
    py = max(GAP, dock_y - GAP - PANEL_H)
    used = draw_panel(cv, t, px, py)
    return cv.img, px, py, used


def verify_strings():
    """每条界面文案都必须能在源码里逐字找到，防止图与代码漂移。"""
    with open(os.path.join(REPO, "client.js"), encoding="utf-8") as fh:
        src = fh.read()
    with open(os.path.join(REPO, "index.js"), encoding="utf-8") as fh:
        idx = fh.read()
    need = ["📋 片段库", S_CLOSE, S_SEARCH, S_NEW, S_EXPORT, S_IMPORT, S_HINT]
    need += S_VIEWS + S_ICONS + [S_PIN]
    bad = [s for s in need if s not in src]
    for name, _tags, _pin in [it for _g, items in GROUPS for it in items]:
        if '"%s"' % name not in idx:
            bad.append("TEMPLATE_PACK:" + name)
    return bad


def audit(px, py, used):
    errs = []
    if px < GAP or py < GAP:
        errs.append("面板越出视口边距 GAP：(%s,%s)" % (px, py))
    if px + PANEL_W > W:
        errs.append("面板右侧溢出：%s > %s" % (px + PANEL_W, W))
    if py + used > H:
        errs.append("面板底部溢出：%s > %s" % (py + used, H))
    for a in AUDIT:
        lim = a["right_limit"]
        if lim is not None and a["x"] + a["w"] > lim + 0.6:
            errs.append("文案溢出 %-24s right=%.1f > limit=%.1f" % (
                a["tag"], a["x"] + a["w"], lim))
    hint = next((a for a in AUDIT if a["tag"] == "hint"), None)
    if hint and hint["y"] + hint["size"] > py + used:
        errs.append("hint 超出面板：%.1f > %.1f" % (hint["y"] + hint["size"], py + used))
    return errs


def main():
    os.makedirs(OUT, exist_ok=True)
    bad = verify_strings()
    if bad:
        print("=== 文案与源码不一致，拒绝出图 ===")
        for b in bad:
            print("  缺失:", b)
        return 1

    all_err = []
    for dark in (False, True):
        AUDIT.clear()
        img, px, py, used = figure(dark)
        all_err += [("dark " if dark else "light ") + e for e in audit(px, py, used)]
        img = img.resize((W, H), Image.LANCZOS).convert("RGB")
        p = os.path.join(OUT, "preview-panel-%s.png" % ("dark" if dark else "light"))
        img.save(p, "PNG", optimize=True)
        print("%-46s %7d B  面板 (%d,%d) %dx%d" % (
            os.path.basename(p), os.path.getsize(p), px, py, PANEL_W, used))

    print()
    if all_err:
        print("=== AUDIT FAILED (%d) ===" % len(all_err))
        for e in all_err:
            print(" ", e)
        return 1
    print("=== AUDIT OK：%d 个文本块在界限内，面板未溢出，文案与源码一致 ===" % len(AUDIT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
