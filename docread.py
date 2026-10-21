"""Reads the text out of a document that somebody gives to Nex (the "+" of the Nex page): plain text, PDF, Office files (docx, xlsx, pptx), OpenDocument
files (odt, ods, odp) and RTF. Nothing is stored and nothing runs: the file is only opened as bytes, the text is cut out of it and cut off at a limit.
Office and OpenDocument files are zip archives, so a file that unpacks to something huge is refused (a "zip bomb") instead of being unpacked."""
import html
import io
import re
import zipfile

MAX_UNPACKED = 24 * 1024 * 1024            # what the parts of a zip may add up to before the file is refused
MAX_PDF_PAGES = 40

TEXT_EXTENSIONS = {"txt", "md", "csv"}
OFFICE_EXTENSIONS = {"docx", "xlsx", "pptx", "odt", "ods", "odp"}
EXTENSIONS = TEXT_EXTENSIONS | OFFICE_EXTENSIONS | {"pdf", "rtf"}


class Unreadable(Exception):
    """The file is not what it says it is, or too big to open, or no text can be read from it."""


def extension(filename):
    name = str(filename or "")
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _tidy(text):
    text = html.unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _member(archive, name, limit=MAX_UNPACKED):
    try:
        info = archive.getinfo(name)
    except KeyError:
        return b""
    if info.file_size > limit:
        raise Unreadable("too_big")
    return archive.read(name)


def _zip(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise Unreadable("bad_file") from error
    if sum(info.file_size for info in archive.infolist()) > MAX_UNPACKED:
        raise Unreadable("too_big")
    return archive


def _docx(data):
    archive = _zip(data)
    xml = _member(archive, "word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</w:p>|<w:br\s*/>|<w:tab\s*/>", "\n", xml)
    return _tidy(re.sub(r"<[^>]+>", "", xml))


def _pptx(data):
    archive = _zip(data)
    slides = sorted((name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)), key=lambda name: int(re.findall(r"\d+", name)[-1]))
    parts = []
    for number, name in enumerate(slides, 1):
        xml = _member(archive, name).decode("utf-8", errors="replace")
        xml = re.sub(r"</a:p>", "\n", xml)
        parts.append(f"Folie {number}:\n" + _tidy(re.sub(r"<[^>]+>", "", xml)))
    return "\n\n".join(parts)


def _xlsx(data):
    archive = _zip(data)
    shared = _member(archive, "xl/sharedStrings.xml").decode("utf-8", errors="replace")
    strings = [_tidy(re.sub(r"<[^>]+>", "", item)) for item in re.findall(r"<si>(.*?)</si>", shared, flags=re.S)]
    sheets = sorted((name for name in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)), key=lambda name: int(re.findall(r"\d+", name)[-1]))
    lines = []
    for name in sheets[:5]:
        xml = _member(archive, name).decode("utf-8", errors="replace")
        for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, flags=re.S):
            cells = []
            for attributes, inner in re.findall(r"<c([^>]*)>(.*?)</c>", row, flags=re.S):
                value = re.search(r"<v>(.*?)</v>", inner, flags=re.S)
                if value is None:
                    continue
                cells.append(strings[int(value.group(1))] if 't="s"' in attributes and value.group(1).isdigit() and int(value.group(1)) < len(strings) else html.unescape(value.group(1)))
            if cells:
                lines.append("\t".join(cells))
        lines.append("")
    return _tidy("\n".join(lines))


def _opendocument(data):
    archive = _zip(data)
    xml = _member(archive, "content.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</text:p>|</text:h>|<text:line-break\s*/>|</table:table-row>", "\n", xml)
    xml = re.sub(r"</table:table-cell>", "\t", xml)
    return _tidy(re.sub(r"<[^>]+>", "", xml))


def _pdf(data):
    try:
        from pypdf import PdfReader
    except ImportError as error:                                # the package is in requirements.txt; without it a PDF cannot be read
        raise Unreadable("no_pdf_reader") from error
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise Unreadable("encrypted")
        parts = []
        for page in reader.pages[:MAX_PDF_PAGES]:
            parts.append(page.extract_text() or "")
            if sum(len(part) for part in parts) > 200000:
                break
    except Unreadable:
        raise
    except Exception as error:                                  # a broken PDF can fail in many ways inside the reader
        raise Unreadable("bad_file") from error
    return _tidy("\n\n".join(parts))


def _rtf(data):
    source = data.decode("latin-1", errors="replace")
    source = re.sub(r"\\par[d]?\b", "\n", source)
    source = re.sub(r"\\'([0-9a-fA-F]{2})", lambda match: bytes([int(match.group(1), 16)]).decode("cp1252", errors="replace"), source)
    source = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", source)
    return _tidy(re.sub(r"[{}]", "", source))


def extract(data, filename, limit=6000):
    """(text, cut): the text of the document, at most `limit` characters, and whether it was longer. Raises Unreadable."""
    kind = extension(filename)
    if kind in TEXT_EXTENSIONS:
        text = _tidy(data[:2_000_000].decode("utf-8", errors="replace"))
    elif kind == "pdf":
        if data[:5] != b"%PDF-":
            raise Unreadable("bad_file")
        text = _pdf(data)
    elif kind == "docx":
        text = _docx(data)
    elif kind == "pptx":
        text = _pptx(data)
    elif kind == "xlsx":
        text = _xlsx(data)
    elif kind in ("odt", "ods", "odp"):
        text = _opendocument(data)
    elif kind == "rtf":
        text = _rtf(data)
    else:
        raise Unreadable("bad_type")
    if not text:
        raise Unreadable("empty")
    return text[:limit], len(text) > limit
