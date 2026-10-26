"""src/pages/*.html 조각 + src/partials 공통 부품 → dist/*.html 완성 문서.

조각 파일 형식
  <!--title: 페이지 제목-->
  <!--desc: 검색 결과에 나오는 한 줄 설명-->
  <style> 이 페이지 전용 CSS </style>   (없어도 됨)
  <main> ... </main> 와 페이지 전용 <script>
  {{JOIN}} 자리에는 partials/join.html(입사·제휴 띠)이 들어간다.

결과물
  dist/                GitHub Pages 에 그대로 올리는 배포본 (사진 안내 딱지 없음, 옛 주소 이동 페이지·CNAME 포함)
  preview/index.html   아티팩트 미리보기용 홈 조각 (doctype 없이 title·meta로 시작)
  preview/*.html       아티팩트에 같이 올리는 하위 페이지 (완성 문서, 홈 링크만 ./ 로)
  dist/en/, preview/en/ 영어판 (src/pages_en + src/partials/en)
"""
import json
import os
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
PARTS = SRC / "partials"
DIST = ROOT / "dist"
PREVIEW = ROOT / "preview"

PAGES = ["index", "company", "business", "service", "solution", "cs", "privacy", "admin"]
DIST_ONLY = ["404"]  # 배포본에만 넣는 페이지 (아티팩트 미리보기엔 안 올림)
# 영어판: src/pages_en/*.html → dist/en/*.html. 머리말·꼬리말·JOIN 띠는 src/partials/en/ 것을 씀
PAGES_EN = ["index", "company", "business", "service", "solution", "cs", "privacy"]

# 옛 사이트 주소 → 새 페이지. 검색 결과·즐겨찾기로 들어오는 사람을 옮겨 줌
# (camver.co.kr 시절 주소 + 지금 camver.ai.kr 에 떠 있는 빌더 사이트 주소)
REDIRECTS = {
    "main": "index.html",
    "page/page9": "index.html",
    "pension_resv/search_form.htm": "index.html",
    "pension_resv/resv_form1.htm": "index.html",
    "page/page23": "company.html#overview",
    "page/yy88": "company.html#history",
    "page/s555": "company.html#partners",
    "page/c001": "business.html#leisure",
    "page/c10": "business.html#leisure",
    "page/page21": "business.html#resort",
    "page/p003": "business.html#resort",
    "page/m002": "business.html",
    "page/c009": "service.html",
    "page/c010": "service.html#station",
    "page/c005": "solution.html",
    "page/g66": "solution.html",
    "page/r55": "cs.html#guide",
    "bbs/rwdboard": "cs.html#news",
    "bbs_shop/read.htm": "cs.html#news",
    "myreg/myreg3": "cs.html#join",
}

FONTS = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap">
"""

HEAD = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{site_name}">
<meta property="og:locale" content="{og_locale}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta name="theme-color" content="#ffffff">
<meta property="og:image" content="{site}/img/og-image.jpg">
<meta property="og:url" content="{url}">
<link rel="canonical" href="{url}">
{alternates}<link rel="icon" href="img/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="img/favicon-32.png">
<link rel="apple-touch-icon" href="img/apple-touch-icon.png">
"""

PREVIEW_HEAD = """<title>캠버 공식 홈페이지</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="icon" type="image/png" href="img/favicon-32.png">
"""

REDIRECT_PAGE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>캠버 CAMVER</title>
<link rel="canonical" href="{site}/{target_page}">
<meta http-equiv="refresh" content="0; url=/{target}">
<script>location.replace('/{target}');</script>
</head>
<body>
<p>페이지 주소가 바뀌었습니다. <a href="/{target}">새 페이지로 이동</a></p>
</body>
</html>
"""



def read(p):
    return p.read_text(encoding="utf-8")


# 사진 교체 안내 딱지. 실제 사진을 다 바꾸면 False 로 두고 다시 빌드하면 사라짐
SHOW_SPECS = os.environ.get("SHOW_SPECS", "0") == "1"  # SHOW_SPECS=1 python3 tools/build.py → 사진 칸 번호·규격 딱지 다시 표시
CONFIG = json.loads((SRC / "config.json").read_text(encoding="utf-8"))


def config_js(lang="ko"):
    """src/config.json → 폼 전송 주소·소식 시트 주소를 페이지에 심는 한 줄.
    소식 시트는 한글 기사 제목이라 영어판에선 안 불러오고 페이지에 적힌 영어 목록을 그대로 씀"""
    news = (CONFIG.get("news_csv") or "") if lang == "ko" else ""
    return ("window.CAMVER_FORM_ENDPOINT = " + json.dumps(CONFIG.get("form_endpoint") or "") + ";\n"
            "window.CAMVER_NEWS_CSV = " + json.dumps(news) + ";\n")


SPECS = {k: v for k, v in json.loads((SRC / "image-specs.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}


def spec_text(slot):
    """딱지 글: 칸 번호 · PC(1920×1080) 화면에서 실제로 보이는 사진 크기(px) / 준비할 사진 / 한 줄 안내"""
    sp = SPECS[slot]
    if sp["scan"]:
        return f'{slot} · {sp["pc"]}px', sp["need"], "PC 기준 실제 크기 · 원본 스캔은 잘리지 않고 통째로 들어감"
    return f'{slot} · {sp["pc"]}px', sp["need"], "PC(1920×1080) 기준 실제 크기 · 2배로 만들면 더 선명"


def add_specs(html, on=True):
    """data-slot 이 붙은 사진 위에 '칸 번호 · 제작 크기 / 준비할 사진 / 화면 크기·안전 영역' 딱지를 붙인다.
    빈 자리(IMAGE 표시)는 안쪽 글씨를 같은 내용으로 맞춘다. 숫자는 image-specs.json(=제작목록 엑셀)."""
    if not (SHOW_SPECS and on):
        return html

    def img(m):
        head, need, small = spec_text(m.group(1))
        return (m.group(0) + f'<span class="imgspec" aria-hidden="true"><b>{head}</b>'
                f'<span>{need}</span><small>{small}</small></span>')

    def ph(m):
        head, need, small = spec_text(m.group(2))
        return f'{m.group(1)}<b>IMAGE <span class="slot">{head}</span></b><strong>{need}</strong><small>{small}</small></div>'

    html = re.sub(r'<img data-slot="([^"]+)"[^>]*>', img, html)
    html = re.sub(r'(<div data-slot="([^"]+)" class="lbl[^"]*"[^>]*>)<b>IMAGE</b>.*?</div>', ph, html, flags=re.S)
    return html


def parse(frag):
    title = re.search(r"<!--title:\s*(.*?)-->", frag).group(1).strip()
    desc = re.search(r"<!--desc:\s*(.*?)-->", frag).group(1).strip()
    flags = {"bare": "<!--bare-->" in frag}
    rm = re.search(r"<!--robots:\s*(.*?)-->", frag)
    flags["robots"] = rm.group(1).strip() if rm else ""
    frag = re.sub(r"<!--(title|desc|robots):.*?-->\s*|<!--bare-->\s*", "", frag)
    css = ""
    m = re.match(r"\s*<style>(.*?)</style>\s*", frag, flags=re.S)
    if m:
        css = m.group(1).strip()
        frag = frag[m.end():]
    return title, desc, css, frag.strip(), flags


def part(fname, lang):
    """공통 부품. 영어판은 partials/en/ 에 있으면 그걸, 없으면(base.css·base.js) 같은 걸 씀"""
    p = PARTS / "en" / fname
    return read(p if lang == "en" and p.exists() else PARTS / fname)


def lang_links(name, lang):
    """머리말 언어 메뉴·Admin 링크. 같은 페이지의 다른 언어판으로 이동"""
    en_name = name if name in PAGES_EN else "index"
    if lang == "en":
        return {"LANG_KO": f"../{name}.html", "LANG_EN": f"{name}.html", "ADMIN": "../admin.html",
                "CUR_KO": "", "CUR_EN": ' aria-current="true"'}
    return {"LANG_KO": f"{name}.html", "LANG_EN": f"en/{en_name}.html", "ADMIN": "admin.html",
            "CUR_KO": ' aria-current="true"', "CUR_EN": ""}


def header_for(name, lang="ko"):
    h = part("header.html", lang)
    if name != "index":
        h = h.replace(f'<a href="{name}.html">', f'<a href="{name}.html" aria-current="page">', 1)
    for k, v in lang_links(name, lang).items():
        h = h.replace("{{%s}}" % k, v)
    return h.strip()


def en_paths(html):
    """영어판은 /en/ 폴더 안에 있어서 이미지 경로를 한 단계 위로"""
    for a in ('src="img/', 'href="img/', 'srcset="img/', "url(img/", "url('img/", 'url("img/'):
        html = html.replace(a, a.replace("img/", "../img/"))
    return html


def assemble(name, specs=True, lang="ko"):
    pages_dir = SRC / ("pages_en" if lang == "en" else "pages")
    title, desc, css, body, flags = parse(read(pages_dir / f"{name}.html"))
    body = body.replace("{{JOIN}}", part("join.html", lang).strip())
    body = body.replace("<main>", '<main id="main" tabindex="-1">', 1)
    body = add_specs(body, specs)
    style = "<style>\n" + read(PARTS / "base.css").strip() + ("\n\n/* 페이지 전용 */\n" + css if css else "") + "\n</style>\n"
    if flags["bare"]:
        # 관리자 바로가기처럼 사이트 머리·꼬리 없이 혼자 서는 페이지
        inner = body + "\n"
    else:
        inner = (
            header_for(name, lang) + "\n\n" + body + "\n\n" + part("footer.html", lang).strip()
            + "\n\n<script>\n" + config_js(lang) + read(PARTS / "base.js").strip() + "\n</script>\n"
        )
    return title, desc, style, inner, flags


def home_links_to_root(html, lang="ko"):
    # 아티팩트에서는 홈이 루트 주소라 index.html 파일이 따로 없음 (영어판 홈은 en/index.html 그대로 있음)
    pat = r'href="\.\./index\.html(#[^"]*)?"' if lang == "en" else r'href="index\.html(#[^"]*)?"'
    root = "../" if lang == "en" else "./"
    return re.sub(pat, lambda m: 'href="' + root + (m.group(1) or "") + '"', html)


def page_url(name, lang="ko"):
    site = CONFIG["site_url"].rstrip("/")
    return site + "/" + ("en/" if lang == "en" else "") + ("" if name == "index" else f"{name}.html")


def head_for(name, lang, title, desc, flags):
    site = CONFIG["site_url"].rstrip("/")
    alt = ""
    if name in PAGES_EN:
        alt = (f'<link rel="alternate" hreflang="ko" href="{page_url(name)}">\n'
               f'<link rel="alternate" hreflang="en" href="{page_url(name, "en")}">\n'
               f'<link rel="alternate" hreflang="x-default" href="{page_url(name)}">\n')
    head = HEAD.format(title=title, desc=desc, site=site, url=page_url(name, lang), lang=lang, alternates=alt,
                       site_name="CAMVER" if lang == "en" else "캠버 CAMVER", og_locale="en_US" if lang == "en" else "ko_KR")
    if flags["robots"]:
        head += f'<meta name="robots" content="{flags["robots"]}">\n'
    return head


def build():
    site = CONFIG["site_url"].rstrip("/")
    DIST.mkdir(exist_ok=True)
    PREVIEW.mkdir(exist_ok=True)
    for out in (DIST, PREVIEW):
        shutil.copytree(SRC / "img", out / "img", dirs_exist_ok=True)
    jobs = [(n, "ko") for n in PAGES + DIST_ONLY] + [(n, "en") for n in PAGES_EN]
    for name, lang in jobs:
        sub = "en/" if lang == "en" else ""
        for d in (DIST, PREVIEW):
            (d / sub).mkdir(parents=True, exist_ok=True)
        fix = en_paths if lang == "en" else (lambda h: h)
        # 배포본(dist)은 사진 안내 딱지 없이, 미리보기(preview)는 SHOW_SPECS 설정대로
        title, desc, style, inner, flags = assemble(name, specs=False, lang=lang)
        head = head_for(name, lang, title, desc, flags)
        if name == "404":
            # 없는 주소 어디서든 뜨는 페이지라 링크·이미지 기준을 사이트 맨 위로 고정
            head = head.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">', 1)
        doc = fix(head + FONTS + style + "</head>\n<body>\n" + inner + "</body>\n</html>\n")
        (DIST / f"{sub}{name}.html").write_text(doc, encoding="utf-8")
        print("built", sub + name, len(doc) // 1024, "KB")
        if name in DIST_ONLY:
            continue
        title, desc, style, inner, flags = assemble(name, specs=True, lang=lang)
        if name == "index" and lang == "ko":
            prev = PREVIEW_HEAD + FONTS + style + inner
        else:
            prev = head_for(name, lang, title, desc, flags) + FONTS + style + "</head>\n<body>\n" + inner + "</body>\n</html>\n"
        (PREVIEW / f"{sub}{name}.html").write_text(home_links_to_root(fix(prev), lang), encoding="utf-8")

    # 옛 주소 이동 페이지
    for old, target in REDIRECTS.items():
        # 확장자 없는 옛 주소(/page/s555)는 폴더 안 index.html 로 만들어야 어느 호스팅에서든 열림
        path = DIST / (old if old.endswith((".htm", ".html")) else old + "/index.html")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(REDIRECT_PAGE.format(site=site, target=target, target_page=target.split("#")[0]), encoding="utf-8")

    # GitHub Pages 용 파일
    (DIST / "CNAME").write_text(CONFIG["domain"].strip() + "\n", encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    public = [(n, "ko") for n in PAGES if n != "admin"] + [(n, "en") for n in PAGES_EN]
    (DIST / "robots.txt").write_text(f"User-agent: *\nDisallow: /admin.html\n\nSitemap: {site}/sitemap.xml\n", encoding="utf-8")
    urls = "".join(f"  <url><loc>{page_url(n, l)}</loc></url>\n" for n, l in public)
    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n", encoding="utf-8")
    print("redirects", len(REDIRECTS), "· CNAME", CONFIG["domain"])


if __name__ == "__main__":
    build()
