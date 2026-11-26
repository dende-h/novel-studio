"""Build and check synthetic inputs for the posting-site import design.

The readers below are local probes for the fixtures. They are not Leaf importers.
Run with Python 3.10+, reportlab, and PyMuPDF; no network access is used.
"""

import io
import json
import re
from collections import defaultdict
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree
from xml.sax.saxutils import escape
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
WORK = "青い灯りの観測日誌"
EPISODE_TITLES = ("灯り　第一夜", "灯り 第二夜", "灯り 第三夜")
EPISODES = [
    (title, (ROOT / "manuscript" / f"{number:02}.txt").read_text(encoding="utf-8").removesuffix("\n"))
    for number, title in enumerate(EPISODE_TITLES, 1)
]
RUBY = re.compile(r"｜([^《\n]+)《([^》\n]+)》")
EMPHASIS = re.compile(r"《《([^》\n]+)》》")
PDF_X = 548
PDF_Y = 727
COLUMN_STEP = 14
ROW_STEP = 14
PDF_ROWS = 47


def plain_body(text):
    return EMPHASIS.sub(r"\1", RUBY.sub(r"\1", text))


def pixiv_body(text):
    text = EMPHASIS.sub(r"[[emphasismark:\1>﹅]]", RUBY.sub(r"[[rb:\1 > \2]]", text))
    paragraphs = text.split("\n\n")
    paragraphs.insert(len(paragraphs) // 2, "[newpage]")
    return "\n\n".join(paragraphs)


PDF_EPISODES = [(title, plain_body(body)) for title, body in EPISODES]


def write_text(name, text, encoding="utf-8", crlf=False):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text_bytes(text, encoding, crlf))


def text_bytes(text, encoding="utf-8", crlf=False):
    return (text.replace("\n", "\r\n") if crlf else text).encode(encoding)


def make_zip(name, members, compression=ZIP_DEFLATED):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", compression=compression) as z:
        for key, data in members.items():
            z.writestr(key, data)


def numbered_text():
    return "\n\n".join(f"第{i}話 {title}\n{body}" for i, (title, body) in enumerate(EPISODES, 1))


def make_pdf():
    path = ROOT / "mock/estar-vertical.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))
    pdf = canvas.Canvas(str(path), pagesize=A4, invariant=True)
    pdf.setTitle(WORK)
    pdf.setSubject("架空の縦書きPDF。エブリスタ固有構造の再現ではありません。")
    for i, (title, body) in enumerate(PDF_EPISODES, 1):
        pdf.bookmarkPage(f"episode-{i}")
        pdf.addOutlineEntry(title, f"episode-{i}")
        pdf.setFont("HeiseiMin-W3", 14)
        pdf.drawString(50, 784, "検証用PDF　" + title)
        pdf.setLineWidth(0.5)
        pdf.line(50, 770, PDF_X + 10, 770)
        pdf.setFont("HeiseiMin-W3", 10.5)
        col = 0
        breaks = 0
        for line in body.split("\n"):
            if not line:
                breaks += 1
                continue
            indent = breaks
            remaining = line
            while remaining:
                x = PDF_X - col * COLUMN_STEP
                if x < 46:
                    raise ValueError(f"PDF episode does not fit: {title}")
                chunk, remaining = remaining[:PDF_ROWS - indent], remaining[PDF_ROWS - indent:]
                for row, char in enumerate(chunk, indent):
                    pdf.drawString(x, PDF_Y - row * ROW_STEP, char)
                col += 1
                indent = 0
            breaks = 1
        pdf.setFont("HeiseiMin-W3", 9)
        pdf.drawString(50, 35, WORK)
        pdf.drawRightString(PDF_X + 10, 35, f"{i} / {len(PDF_EPISODES)}")
        pdf.showPage()
    pdf.save()


def build():
    about = f"〖タイトル〗\n{WORK}\n\n〖目次〗\n" + "\n".join(
        f"{i}. {title}" for i, (title, _) in enumerate(EPISODES, 1)
    )
    kakuyomu = {"about.txt": about}
    for i, (title, body) in reversed(tuple(enumerate(EPISODES, 1))):
        lines = len(body.split("\n"))
        kakuyomu[f"episode_{i:04}.txt"] = (
            f"〖タイトル〗\n{title}\n\n〖公開状態〗\n下書き\n\n〖本文（{lines}行）〗\n{body}"
        )
    make_zip("observed/kakuyomu.zip", kakuyomu)
    make_zip("observed/kakuyomu-compatible.zip", kakuyomu | {"about.txt": about + "\n\n検証用の付記"})

    for version, title_field, marker in [
        ("legacy", "サブタイトル", lambda n: f"---- 第{n}部分開始 ----"),
        ("recent", "エピソードタイトル", lambda n: f"---- エピソード{n}開始 ----"),
    ]:
        chunks = [f"〖Nコード〗\nN0000ZZ\n\n〖タイトル〗\n{WORK}"]
        for i, (title, body) in enumerate(EPISODES, 1):
            chunks.append(f"{marker(i)}\n〖{title_field}〗\n{title}\n\n〖本文〗\n{body}")
        data = text_bytes("\n\n".join(chunks), "utf-8-sig", True)
        make_zip(f"observed/narou-{version}-n0000zz.zip", {"n0000zz.txt": data, "n0000zz_review.txt": "検証用レビュー"})

    akatsuki = {
        "nvl00000/0000_目次.txt": text_bytes(f"{WORK}\n\n［目次］\n" + "\n".join(
            f"{i}. {title}" for i, (title, _) in enumerate(EPISODES, 1)
        ), crlf=True)
    }
    for i, (title, body) in reversed(tuple(enumerate(EPISODES, 1))):
        filename = title.replace("　", " ").replace(" ", "")
        footer = "\n\n――――――\n検証用の出典\nhttps://www.akatsuki-novels.com/example\n検証用の注記"
        akatsuki[f"nvl00000/{i:04}_{filename}.txt"] = text_bytes(f"{title}\n\n{body}{footer}", crlf=True)
    make_zip("observed/akatsuki-txt.zip", akatsuki, ZIP_STORED)

    make_zip("mock/novelup.zip", {
        "mock-work-info.txt": WORK,
        **{f"episode_{i:05}.txt": f"話名：\n{title}\n本文：\n{body}" for i, (title, body) in enumerate(EPISODES, 1)},
    })
    make_zip("mock/tales.zip", {
        "about.txt": f"# タイトル\n{WORK}",
        **{f"mock_episode_{i:04}.txt": f"# エピソードタイトル\n{title}\n# 本文\n{body}" for i, (title, body) in enumerate(EPISODES, 1)},
    })
    write_text("mock/alphapolis.txt", numbered_text(), "cp932", crlf=True)
    make_zip("mock/alphapolis.zip", {"mock-work.txt": (ROOT / "mock/alphapolis.txt").read_bytes()})
    write_text("mock/solispia.txt", numbered_text())
    first_body = EPISODES[0][1]
    write_text("fallback/novel-days-body.txt", first_body)
    write_text("fallback/pixiv.txt", pixiv_body(first_body))
    for site in ("teller-novel", "novema", "noichigo", "berrys-cafe"):
        write_text(f"fallback/{site}.txt", first_body)
    for number, (_, body) in zip((2, 10, 20), EPISODES):
        write_text(f"observed/folder/章{number}/01_原稿.txt", body)
    write_text("fallback/encoding-euc-jp.txt", first_body, "euc_jp")
    write_text("fallback/encoding-iso-2022-jp.txt", first_body, "iso2022_jp")
    make_epub()
    make_pdf()

    (ROOT / "rejected").mkdir(exist_ok=True)
    (ROOT / "rejected/image-renamed.txt").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00")
    (ROOT / "rejected/broken.zip").write_bytes(b"PK\x03\x04truncated")
    make_zip("rejected/missing-body.zip", {"about.txt": about, "episode_0001.txt": "〖タイトル〗\n灯り"})
    make_zip("rejected/unsupported-only.zip", {"file.bin": b"\x00"})
    make_zip("rejected/invalid-member.zip", {"../outside.txt": "このファイルは展開しない"})


def make_epub():
    entries = [("episode-" + str(i), f"{len(EPISODES) + 1 - i:02}.xhtml", title, body)
               for i, (title, body) in enumerate(EPISODES, 1)]
    manifest = "".join(f'<item id="{key}" href="{name}" media-type="application/xhtml+xml"/>'
                       for key, name, _, _ in entries)
    spine = "".join(f'<itemref idref="{key}"/>' for key, _, _, _ in entries)
    package = f"""<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="id">
<metadata><dc:identifier id="id">urn:leaf:synthetic</dc:identifier><dc:title>{escape(WORK)}</dc:title><dc:language>ja</dc:language><meta property="dcterms:modified">2026-11-27T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{manifest}</manifest>
<spine>{spine}</spine></package>"""
    xml = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{}</title></head><body>{}</body></html>'
    toc = "".join(f'<li><a href="{name}">{escape(title)}</a></li>' for _, name, title, _ in entries)
    members = {
        "META-INF/container.xml": """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/contents.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""",
        "OEBPS/contents.opf": package,
        "OEBPS/nav.xhtml": xml.format("目次", '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>' + toc + "</ol></nav>"),
    }
    for _, name, title, body in reversed(entries):
        content = EMPHASIS.sub(r"<em>\1</em>", RUBY.sub(r"<ruby>\1<rt>\2</rt></ruby>", escape(body)))
        paragraphs = "".join(f"<p>{line}</p>" for line in content.split("\n"))
        members[f"OEBPS/{name}"] = xml.format(escape(title), paragraphs)
    with ZipFile(ROOT / "mock/hameln-standard.epub", "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        for name, data in members.items():
            z.writestr(name, data, compress_type=ZIP_DEFLATED)


def decode_text(content, encoding="utf-8-sig"):
    text = content.decode(encoding)
    if any(ord(ch) < 32 and ch not in "\t\r\n" for ch in text):
        raise ValueError("non-text input")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def read_zip(name):
    with ZipFile(ROOT / name) as z:
        names = z.namelist()
        if len(set(names)) != len(names):
            raise ValueError("duplicate member")
        for n in names:
            path = PurePosixPath(n)
            if path.is_absolute() or ".." in path.parts or "\\" in n:
                raise ValueError("invalid member path")
        return {name: z.read(name) for name in names if not name.endswith("/")}


def required_field(text, marker):
    match = re.search(r"(?m)^" + re.escape(marker) + r"\n([^\n]+)", text)
    if not match:
        raise ValueError(f"missing {marker}")
    return match[1]


def read_kakuyomu(name):
    members = read_zip(name)
    about = decode_text(members["about.txt"])
    episodes = []
    names = sorted(n for n in members if re.fullmatch(r"episode_\d{4,}\.txt", n))
    if not names:
        raise ValueError("missing episode files")
    for n in names:
        text = decode_text(members[n])
        title = required_field(text, "〖タイトル〗")
        m = re.search(r"(?m)^〖本文（(\d+)行）〗\n", text)
        if not m:
            raise ValueError("missing Kakuyomu body")
        body = text[m.end():]
        if len(body.split("\n")) != int(m[1]):
            raise ValueError("body line count mismatch")
        episodes.append((title, body))
    return required_field(about, "〖タイトル〗"), episodes


def read_narou(name, separator, title_marker):
    members = read_zip(name)
    title_file = next(n for n in members if re.fullmatch(r"n\d{4}[a-z]{1,2}\.txt", n, re.I))
    text = decode_text(members[title_file])
    work_title = required_field(text, "〖タイトル〗")
    sections = re.split(r"(?m)^-{2,} " + separator + r" -{2,}\n", text)
    if len(sections) < 2:
        raise ValueError("missing episode start")
    episodes = []
    for part in sections[1:]:
        title = required_field(part, title_marker)
        match = re.search(r"(?m)^〖本文〗\n", part)
        if not match:
            raise ValueError("missing Narou body")
        episodes.append((title, part[match.end():].removesuffix("\n\n")))
    return work_title, episodes


def read_akatsuki(name):
    members = read_zip(name)
    toc = next(decode_text(data) for n, data in members.items() if n.endswith("/0000_目次.txt"))
    episodes = []
    for n in sorted(members, key=lambda path: PurePosixPath(path).name):
        if not re.fullmatch(r"(?!0000)\d{4,}_.+\.txt", PurePosixPath(n).name):
            continue
        title, body = decode_text(members[n]).split("\n\n", 1)
        if title not in toc:
            raise ValueError("title missing from the mock contents")
        body = re.sub(r"\n\n――――――\n[^\n]+\nhttps://www\.akatsuki-novels\.com/\S+\n[^\n]+\Z", "", body)
        episodes.append((title, body))
    return toc.splitlines()[0], episodes


def read_mock_series(name, entry_pattern, title_marker, body_marker, work_info):
    members = read_zip(name)
    members = {name: decode_text(data) for name, data in members.items()}
    work_name = work_info(members)
    episodes = []
    for n in sorted(members):
        if re.fullmatch(entry_pattern, n):
            title = required_field(members[n], title_marker)
            _, sep, body = members[n].partition("\n" + body_marker + "\n")
            if not sep:
                raise ValueError("missing mock body")
            episodes.append((title, body))
    return work_name, episodes


def plain_headings(text):
    parts = re.split(r"(?m)^第\d+話 ([^\n]+)\n", text)
    return [(title, body.removesuffix("\n\n")) for title, body in zip(parts[1::2], parts[2::2])]


def read_pdf(name):
    import fitz

    with fitz.open(ROOT / name) as pdf:
        episodes = []
        for _, title, n in pdf.get_toc():
            columns = defaultdict(dict)
            page = pdf[n - 1]
            for block in page.get_text("rawdict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        for glyph in span["chars"]:
                            x, y = glyph["origin"]
                            col = (PDF_X - x) / COLUMN_STEP
                            row = (y - (page.rect.height - PDF_Y)) / ROW_STEP
                            if 0 <= col < 37 and -0.01 <= row < PDF_ROWS and abs(col - round(col)) < 0.01 and abs(row - round(row)) < 0.01:
                                columns[round(col)][round(row)] = glyph["c"]
            text = []
            for _, rows in sorted(columns.items()):
                start, end = min(rows), max(rows)
                text.append("\n" * start + "".join(rows.get(i, " ") for i in range(start, end + 1)))
            episodes.append((title, "".join(text)))
        return pdf.metadata["title"], episodes


def read_epub(name):
    members = read_zip(name)
    container = ElementTree.fromstring(members["META-INF/container.xml"])
    opf = PurePosixPath(container.find(".//{*}rootfile").attrib["full-path"])
    package = ElementTree.fromstring(members[str(opf)])
    items = {item.attrib["id"]: item.attrib["href"] for item in package.findall(".//{*}item")}
    episodes = []
    for ref in package.findall(".//{*}itemref"):
        page = ElementTree.fromstring(members[str(opf.parent / items[ref.attrib["idref"]])])
        lines = []
        for para in page.findall(".//{*}p"):
            parts = [para.text or ""]
            for inline in para:
                if inline.tag.endswith("}ruby"):
                    parts.append(f"｜{inline.text}《{inline.findtext('{*}rt')}》")
                elif inline.tag.endswith("}em"):
                    parts.append(f"《《{inline.text}》》")
                parts.append(inline.tail or "")
            lines.append("".join(parts))
        episodes.append((page.findtext(".//{*}title"), "\n".join(lines)))
    return package.findtext(".//{*}title"), episodes


def check():
    cases = []

    def success(label, actual, expected):
        if actual != expected:
            raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
        cases.append(f"PASS  {label}")

    def failure(label, reader, expected_error):
        try:
            reader()
        except (BadZipFile, ValueError) as error:
            if not isinstance(error, expected_error):
                raise
        else:
            raise AssertionError(f"{label}: expected rejection")
        cases.append(f"PASS  {label}")

    target = (WORK, EPISODES)
    for n in ("kakuyomu.zip", "kakuyomu-compatible.zip"):
        success(n, read_kakuyomu("observed/" + n), target)
    success("narou 2023", read_narou("observed/narou-legacy-n0000zz.zip", r"第\d+部分開始", "〖サブタイトル〗"), target)
    success("narou 2026", read_narou("observed/narou-recent-n0000zz.zip", r"エピソード\d+開始", "〖エピソードタイトル〗"), target)
    success("akatsuki: title from first line, numeric order", read_akatsuki("observed/akatsuki-txt.zip"), target)

    success("mock novelup structure", read_mock_series("mock/novelup.zip", r"episode_\d{5}\.txt", "話名：", "本文：", lambda m: m["mock-work-info.txt"]), target)
    success("mock tales structure", read_mock_series("mock/tales.zip", r"mock_episode_\d{4}\.txt", "# エピソードタイトル", "# 本文", lambda m: required_field(m["about.txt"], "# タイトル")), target)
    for data, label, encoding in [
        ((ROOT / "mock/alphapolis.txt").read_bytes(), "mock alpha CP932 TXT", "cp932"),
        (read_zip("mock/alphapolis.zip")["mock-work.txt"], "mock alpha CP932 ZIP", "cp932"),
        ((ROOT / "mock/solispia.txt").read_bytes(), "mock solispia headings", "utf-8-sig"),
    ]:
        success(label, plain_headings(decode_text(data, encoding)), EPISODES)
    success("mock vertical PDF: chapters and reading order", read_pdf("mock/estar-vertical.pdf"), (WORK, PDF_EPISODES))
    lengths = [len(plain_body(body).replace("\n", "")) for _, body in EPISODES]
    success("three prose episodes, approximately 1000 characters each",
            len(lengths) == 3 and all(900 <= count <= 1100 for count in lengths), True)
    success("mock EPUB: spine order and ruby", read_epub("mock/hameln-standard.epub"), target)
    first_body = EPISODES[0][1]
    for suffix, enc in [("euc-jp", "euc_jp"), ("iso-2022-jp", "iso2022_jp")]:
        success(suffix + " decode", decode_text((ROOT / f"fallback/encoding-{suffix}.txt").read_bytes(), enc), first_body)
    for path in sorted((ROOT / "fallback").glob("*.txt")):
        if path.name.startswith("encoding-"):
            continue
        text = decode_text(path.read_bytes())
        if path.name.startswith("pixiv"):
            success("pixiv tags retained verbatim", text, pixiv_body(first_body))
        else:
            success(path.stem + " one-episode TXT", text, first_body)
    folder = ROOT / "observed/folder"
    paths = sorted(folder.rglob("*.txt"), key=lambda p: [int(n) if n.isdecimal() else n for n in re.split(r"(\d+)", p.relative_to(folder).as_posix())])
    success("folder natural path order", [decode_text(p.read_bytes()) for p in paths], [body for _, body in EPISODES])
    failure("image renamed txt", lambda: decode_text((ROOT / "rejected/image-renamed.txt").read_bytes()), ValueError)
    failure("broken zip", lambda: read_zip("rejected/broken.zip"), BadZipFile)
    failure("missing required Kakuyomu body", lambda: read_kakuyomu("rejected/missing-body.zip"), ValueError)
    failure("unsafe archive member", lambda: read_zip("rejected/invalid-member.zip"), ValueError)
    success("zip with no supported document flagged", any(n.endswith((".txt", ".pdf", ".epub")) for n in read_zip("rejected/unsupported-only.zip")), False)
    (ROOT / "expectations.json").write_text(json.dumps({
        "title": WORK, "episodes": EPISODES, "vertical_pdf": PDF_EPISODES, "epub": EPISODES, "prose_character_counts": lengths,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    checks = "\n".join(cases) + f"\n\n{len(cases)} checks passed.\n"
    (ROOT / "results.txt").write_text(checks, encoding="utf-8")
    print(checks, end="")


if __name__ == "__main__":
    build()
    check()
