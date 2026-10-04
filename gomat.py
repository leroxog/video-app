"""gomat: a maths course in the style of the big language-learning apps -- short lessons, a learning path,
hearts, streaks, XP -- in German and in blue. All code, texts and artwork are original.

There is nothing to sign in to and nothing to store here: the browser keeps the learner's progress
(static/js/gomat-core.js). This module only provides the course:

  * the curriculum (units -> lessons), shown as the learning path;
  * the exercises. They are generated, not written one by one, so every lesson is new every time:
    each generator makes one exercise from a random number generator, with the right answer, wrong
    options that are really wrong, and a short explanation for when the answer was not right.

Exercise types the page can show:
  choice  {prompt, options[], answer (index)}           pick one card
  input   {prompt, answer}                              type a number on the keypad
  speak   {prompt, answer}                              say the number out loud (only when the browser asked for it)
  match   {prompt, pairs[[left, right], ...]}           connect the pairs
  build   {prompt, tokens[], answer[]}                  put tiles in the right order
Every exercise also has `explain`, and may have a `visual` (dots, array, pie, bar, rect, triangle).
Generators add a private `_meta` (an expression and its value) that the tests use to re-check the maths
independently; it never leaves the server.
"""
import json
import os
import random
import re
from fractions import Fraction
from math import gcd

from flask import Response, jsonify, render_template, request, url_for

import ysound

LESSON_LENGTH = 10
TEST_LENGTH = 12
TEST_MAX_MISTAKES = 3          # a master test is passed with at most this many mistakes (gomat-core.js uses the same number)
SPEAK_PER_LESSON = 2
SPEAK_PER_TEST = 1
PLACEMENT_PER_UNIT = 3
PLACEMENT_QUESTIONS = 10
CAST = ("gomi", "otto", "ben", "robi")      # the characters; a unit's character is CAST[(unit - 1) % 4]
MINUS = "−"
LESSON_ID_RE = re.compile(r"([1-9])-([1-9])")
PUBLIC_ENDPOINTS = {"pl_home", "gomat_lesson", "gomat_practice", "gomat_placement"}
LEGAL_ENDPOINTS = {"gomat_privacy", "gomat_imprint"}
META_ENDPOINTS = {"gomat_manifest", "gomat_robots", "gomat_sitemap"}
PAGE_ENDPOINTS = {"pl_home"} | LEGAL_ENDPOINTS
# Routes of this module never need the site's session cookie (nothing is stored on the server).
NO_COOKIE_ENDPOINTS = PUBLIC_ENDPOINTS | LEGAL_ENDPOINTS | META_ENDPOINTS

# What the pages may load: only our own files. (Styles may be set inline by the script; scripts may not.)
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
TAGLINE = "Mathe lernen, Schritt für Schritt"
DESCRIPTION = "gomat: Mathe lernen in kurzen Lektionen, wie ein Spiel. Kostenlos, ohne Anmeldung, ohne Cookies."
ARCHIVE_PATHS = ("/ysound-archiv", "/sound-archiv", "/server-archiv", "/browser-archiv", "/ylib-archiv", "/ychat-archiv", "/nex-archiv")

PEOPLE = [("Mia", "Sie"), ("Ben", "Er"), ("Lena", "Sie"), ("Tom", "Er"), ("Emma", "Sie"), ("Leo", "Er"),
          ("Anna", "Sie"), ("Paul", "Er"), ("Sophie", "Sie"), ("Max", "Er"), ("Lea", "Sie"), ("Finn", "Er")]
THINGS = ["Sticker", "Murmeln", "Äpfel", "Bonbons", "Karten", "Stifte", "Kekse", "Bücher", "Muscheln", "Kugeln"]


# ------------------------------------------------------------------- formatting

def sgn(n):
    return f"{MINUS}{abs(n)}" if n < 0 else str(n)


def dec(scaled, places=1, trim=False):
    """An integer that stands for scaled / 10**places as a German decimal ('3,5')."""
    sign = MINUS if scaled < 0 else ""
    scaled = abs(scaled)
    whole, rest = divmod(scaled, 10 ** places)
    digits = f"{rest:0{places}d}"
    if trim:
        digits = digits.rstrip("0")
    return f"{sign}{whole}" + (f",{digits}" if digits else "")


def frac(n, d):
    return f"{n}/{d}"


def value_of(number):
    """A Fraction as the text the tests compare with."""
    f = Fraction(number)
    return str(f.numerator) if f.denominator == 1 else f"{f.numerator}/{f.denominator}"


# ------------------------------------------------------------- exercise makers

def _unique(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def choice(rng, prompt, correct, wrong, explain, visual=None, meta=None):
    correct = str(correct)
    wrong = [w for w in _unique(str(w) for w in wrong) if w != correct]
    if not wrong:
        raise ValueError(f"no wrong options for {prompt!r}")
    rng.shuffle(wrong)
    options = [correct] + wrong[:3]
    rng.shuffle(options)
    return {"type": "choice", "prompt": prompt, "options": options, "answer": options.index(correct),
            "explain": explain, "visual": visual, "_meta": meta}


def typed(prompt, answer, explain, unit="", visual=None, meta=None):
    return {"type": "input", "prompt": prompt, "answer": str(answer), "unit": unit, "explain": explain,
            "visual": visual, "_meta": meta}


def matching(rng, prompt, pairs, explain, meta=None):
    pairs = [list(map(str, p)) for p in pairs]
    return {"type": "match", "prompt": prompt, "pairs": pairs, "explain": explain, "visual": None, "_meta": meta}


def building(rng, prompt, answer, explain, extra=(), meta=None):
    answer = [str(a) for a in answer]
    tokens = answer + [str(e) for e in extra]
    rng.shuffle(tokens)
    if tokens == answer and len(set(tokens)) > 1:
        tokens.reverse()
    return {"type": "build", "prompt": prompt, "tokens": tokens, "answer": answer, "explain": explain,
            "visual": None, "_meta": meta}


def either(rng, prompt, answer, wrong, explain, unit="", visual=None, meta=None, typed_odds=0.5):
    """The same question as a typed answer or as cards, whichever the dice say."""
    if rng.random() < typed_odds:
        return typed(prompt, answer, explain, unit, visual, meta)
    return choice(rng, prompt, answer, wrong, explain, visual, meta)


def near(rng, correct, low=0, high=None, extra=()):
    """Plausible wrong numbers around the right one (never the right one, never out of range)."""
    pool = [correct + d for d in (1, -1, 2, -2, 3, -3, 10, -10, 5, -5)] + list(extra)
    pool = [p for p in _unique(pool) if p != correct and p >= low and (high is None or p <= high)]
    close = [p for p in pool if abs(p - correct) <= 3]
    rng.shuffle(close)
    rest = [p for p in pool if p not in close]
    rng.shuffle(rest)
    out = (close + rest)[:3]
    step = 1
    while len(out) < 3:                       # tiny ranges: widen until there are three
        step += 1
        for c in (correct + step, correct - step):
            if c != correct and c >= low and (high is None or c <= high) and c not in out and len(out) < 3:
                out.append(c)
        if step > 50:
            break
    return out


def _meta(expr, value):
    return {"expr": expr, "value": value_of(value)}


# ------------------------------------------------------------------ unit 1 + 2: counting and adding

def count_dots(rng, p):
    n = rng.randint(1, p.get("max", 10))
    return either(rng, "Wie viele Punkte siehst du?", n, near(rng, n, 1, 20), f"Zähle die Punkte einzeln: es sind {n}.",
                  visual={"kind": "dots", "n": n}, meta=_meta(str(n), n), typed_odds=0.3)


def compare_sign(rng, p):
    top = p.get("max", 20)
    a, b = rng.randint(0, top), rng.randint(0, top)
    if rng.random() < 0.15:
        b = a
    sign = "<" if a < b else ">" if a > b else "="
    words = {"<": "kleiner als", ">": "größer als", "=": "genauso groß wie"}
    return choice(rng, f"Welches Zeichen passt? {a} ▢ {b}", sign, [s for s in "<>=" if s != sign],
                  f"{a} ist {words[sign]} {b}, also schreibst du {a} {sign} {b}.")


def bigger_number(rng, p):
    top = p.get("max", 20)
    nums = rng.sample(range(0, top + 1), 3)
    if rng.random() < 0.5:
        best, label = max(nums), "größte"
    else:
        best, label = min(nums), "kleinste"
    return choice(rng, f"Welche Zahl ist die {label}?", best, [n for n in nums if n != best],
                  f"Vergleiche alle Zahlen: {best} ist die {label}.")


def neighbor(rng, p):
    top = p.get("max", 20)
    n = rng.randint(1, top - 1)
    if rng.random() < 0.5:
        return either(rng, f"Welche Zahl kommt direkt nach {n}?", n + 1, near(rng, n + 1, 0, top + 1),
                      f"Nach {n} kommt {n + 1}.", meta=_meta(f"{n}+1", n + 1))
    return either(rng, f"Welche Zahl kommt direkt vor {n + 1}?", n, near(rng, n, 0, top),
                  f"Vor {n + 1} kommt {n}.", meta=_meta(f"{n + 1}-1", n))


def add(rng, p):
    top = p.get("max", 20)
    lowest = p.get("min", 1)
    carry = p.get("carry")                      # None: any, True: with carry, False: without
    for _ in range(60):
        a, b = rng.randint(lowest, top - 1), rng.randint(lowest, top - 1)
        if a + b > top or a + b < lowest + 1:
            continue
        has_carry = (a % 10) + (b % 10) >= 10
        if carry is not None and has_carry != carry:
            continue
        break
    s = a + b
    hint = f"{a} + {b} = {s}."
    if top <= 20 and a < 10 < s and a != 10:
        hint += f" Tipp: Fülle erst auf 10 auf ({a} + {10 - a}) und rechne dann noch {b - (10 - a)} dazu."
    elif top > 20:
        hint += " Tipp: Rechne erst die Zehner, dann die Einer."
    return either(rng, f"{a} + {b} = ?", s, near(rng, s, 0, top + 10), hint, meta=_meta(f"{a}+{b}", s))


def sub(rng, p):
    top = p.get("max", 20)
    borrow = p.get("borrow")
    for _ in range(60):
        a = rng.randint(2, top)
        b = rng.randint(1, a - 1)
        has_borrow = (a % 10) < (b % 10)
        if borrow is not None and has_borrow != borrow:
            continue
        break
    d = a - b
    hint = f"{a} − {b} = {d}."
    if top <= 20 and a > 10 > d and b > a - 10:
        hint += f" Tipp: Gehe erst bis zur 10 zurück ({a} − {a - 10}) und ziehe dann noch {b - (a - 10)} ab."
    elif top > 20:
        hint += " Tipp: Ziehe erst die Zehner ab, dann die Einer."
    return either(rng, f"{a} − {b} = ?", d, near(rng, d, 0, top), hint, meta=_meta(f"{a}-{b}", d))


def missing_addend(rng, p):
    top = p.get("max", 20)
    a = rng.randint(1, top - 1)
    s = rng.randint(a + 1, top)
    b = s - a
    if rng.random() < 0.5:
        return either(rng, f"{a} + ▢ = {s}", b, near(rng, b, 0, top), f"{s} − {a} = {b}, also fehlt die {b}.",
                      meta=_meta(f"{s}-{a}", b))
    return either(rng, f"▢ + {a} = {s}", b, near(rng, b, 0, top), f"{s} − {a} = {b}, also fehlt die {b}.",
                  meta=_meta(f"{s}-{a}", b))


def make_ten(rng, p):
    a = rng.randint(1, 9)
    return either(rng, f"{a} + ▢ = 10", 10 - a, near(rng, 10 - a, 0, 10), f"{a} und {10 - a} ergeben zusammen 10.",
                  meta=_meta(f"10-{a}", 10 - a))


def match_calc(rng, p):
    op = p.get("op", "add")
    top = p.get("max", 20)
    pairs, results = [], set()
    while len(pairs) < 4:
        if op == "sub":
            a = rng.randint(3, top)
            b = rng.randint(1, a - 1)
            left, res = f"{a} − {b}", a - b
        elif op == "times":
            rows = p.get("rows", [2, 5, 10])
            a, b = rng.choice(rows), rng.randint(2, 10)
            left, res = f"{a} × {b}", a * b
        elif op == "divide":
            rows = p.get("rows", [2, 5, 10])
            b, q = rng.choice(rows), rng.randint(2, 10)
            left, res = f"{b * q} ÷ {b}", q
        else:
            a, b = rng.randint(1, top - 1), rng.randint(1, top - 1)
            if a + b > top:
                continue
            left, res = f"{a} + {b}", a + b
        if res in results:
            continue
        results.add(res)
        pairs.append((left, str(res)))
    return matching(rng, "Finde die passenden Paare.", pairs, "Rechne jede Aufgabe einzeln aus und suche das Ergebnis.")


def sort_numbers(rng, p):
    top = p.get("max", 100)
    count = p.get("count", 4)
    nums = rng.sample(range(p.get("min", 0), top + 1), count)
    ascending = rng.random() < 0.5
    ordered = sorted(nums, reverse=not ascending)
    text = "klein nach groß" if ascending else "groß nach klein"
    return building(rng, f"Sortiere von {text}.", [sgn(n) for n in ordered],
                    f"Die richtige Reihenfolge von {text}: " + ", ".join(sgn(n) for n in ordered) + ".")


def word_addsub(rng, p):
    top = p.get("max", 20)
    name, pron = rng.choice(PEOPLE)
    thing = rng.choice(THINGS)
    if rng.random() < 0.5:
        a = rng.randint(2, top - 2)
        b = rng.randint(1, top - a)
        return either(rng, f"{name} hat {a} {thing}. {pron} bekommt {b} dazu. Wie viele {thing} hat {name} jetzt?", a + b,
                      near(rng, a + b, 0, top + 5), f"Dazubekommen heißt plus: {a} + {b} = {a + b}.",
                      meta=_meta(f"{a}+{b}", a + b))
    a = rng.randint(3, top)
    b = rng.randint(1, a - 1)
    return either(rng, f"{name} hat {a} {thing}. {pron} verschenkt {b}. Wie viele {thing} bleiben übrig?", a - b,
                  near(rng, a - b, 0, top), f"Verschenken heißt minus: {a} − {b} = {a - b}.", meta=_meta(f"{a}-{b}", a - b))


def place_value(rng, p):
    n = rng.randint(11, 99)
    tens, ones = divmod(n, 10)
    kind = rng.randint(0, 2)
    if kind == 0:
        return either(rng, f"Wie viele Zehner hat die Zahl {n}?", tens, near(rng, tens, 0, 9, extra=[ones]),
                      f"{n} = {tens} Zehner und {ones} Einer.", meta=_meta(str(tens), tens))
    if kind == 1:
        return either(rng, f"Wie viele Einer hat die Zahl {n}?", ones, near(rng, ones, 0, 9, extra=[tens]),
                      f"{n} = {tens} Zehner und {ones} Einer.", meta=_meta(str(ones), ones))
    swapped = ones * 10 + tens
    return choice(rng, f"Welche Zahl besteht aus {tens} Zehnern und {ones} Einern?", n,
                  [swapped, n + 10, n - 10, n + 1] if ones != tens else [n + 10, n - 10, n + 1, n - 1],
                  f"{tens} Zehner sind {tens * 10}, dazu {ones} Einer: {n}.", meta=_meta(f"{tens}*10+{ones}", n))


def add_tens(rng, p):
    if rng.random() < 0.4:
        a = rng.randint(3, 10) * 10
        b = rng.randint(1, a // 10 - 1) * 10
        return either(rng, f"{a} − {b} = ?", a - b, near(rng, a - b, 0, 100, extra=[a - b + 10, a - b - 10]),
                      f"{a // 10} Zehner minus {b // 10} Zehner = {(a - b) // 10} Zehner = {a - b}.", meta=_meta(f"{a}-{b}", a - b))
    a = rng.randint(1, 8) * 10
    b = rng.randint(1, (100 - a) // 10) * 10
    return either(rng, f"{a} + {b} = ?", a + b, near(rng, a + b, 0, 110, extra=[a + b + 10, a + b - 10]),
                  f"{a // 10} Zehner plus {b // 10} Zehner = {(a + b) // 10} Zehner = {a + b}.", meta=_meta(f"{a}+{b}", a + b))


def round_tens(rng, p):
    n = rng.randint(11, 98)
    while n % 10 == 0:
        n = rng.randint(11, 98)
    down, up = n // 10 * 10, n // 10 * 10 + 10
    best = up if n % 10 >= 5 else down
    return choice(rng, f"Runde {n} auf den nächsten Zehner.", best, [down if best == up else up, best + 10 if best == up else best - 10,
                                                      n, n + 1],
                  f"Schau auf die Einerstelle ({n % 10}): Ab 5 rundest du auf, sonst ab. Also {best}.",
                  meta=_meta(str(best), best))


# ------------------------------------------------------------------- unit 3 + 4: times tables and sharing

def _row(rng, p):
    rows = p.get("rows", [2, 5, 10])
    return rng.choice(rows), rng.randint(1, 10)


def times(rng, p):
    a, b = _row(rng, p)
    if rng.random() < 0.5:
        a, b = b, a
    return either(rng, f"{a} × {b} = ?", a * b, near(rng, a * b, 0, 100, extra=[a * (b + 1), a * (b - 1), (a + 1) * b]),
                  f"{a} × {b} = {a * b}. Du kannst auch {b} × {a} rechnen, das Ergebnis ist dasselbe.", meta=_meta(f"{a}*{b}", a * b))


def times_missing(rng, p):
    a, b = _row(rng, p)
    return either(rng, f"{a} × ▢ = {a * b}", b, near(rng, b, 1, 12), f"{a * b} ÷ {a} = {b}, also fehlt die {b}.",
                  meta=_meta(f"{a * b}/{a}", b))


def times_array(rng, p):
    rows, cols = rng.randint(2, 5), rng.randint(2, 8)
    return either(rng, f"Wie viele Punkte sind es? ({rows} Reihen mit je {cols} Punkten)", rows * cols,
                  near(rng, rows * cols, 1, 60, extra=[rows + cols, rows * (cols + 1)]),
                  f"{rows} Reihen mit je {cols} Punkten: {rows} × {cols} = {rows * cols}.",
                  visual={"kind": "array", "rows": rows, "cols": cols}, meta=_meta(f"{rows}*{cols}", rows * cols))


def times_word(rng, p):
    a, b = _row(rng, p)
    b = max(b, 2)
    thing = rng.choice(["Äpfel", "Kekse", "Stifte", "Murmeln", "Sticker", "Bonbons"])
    box = rng.choice(["Tüten", "Schachteln", "Taschen", "Dosen"])
    return either(rng, f"In {a} {box} sind jeweils {b} {thing}. Wie viele {thing} sind das zusammen?", a * b,
                  near(rng, a * b, 1, 120, extra=[a + b]), f"{a} mal {b}: {a} × {b} = {a * b}.", meta=_meta(f"{a}*{b}", a * b))


def multiples(rng, p):
    rows = p.get("rows", [2, 5, 10])
    r = rng.choice(rows)
    right = r * rng.randint(2, 10)
    wrong = []
    while len(wrong) < 3:
        w = rng.randint(5, 100)
        if w % r != 0 and w not in wrong:
            wrong.append(w)
    return choice(rng, f"Welche Zahl steht in der {r}er-Reihe?", right, wrong,
                  f"Zur {r}er-Reihe gehören alle Zahlen, die du mit {r} malnehmen kannst, zum Beispiel {right} = {r} × {right // r}.",
                  meta=_meta(f"{right}/{r}*{r}", right))


def divide(rng, p):
    d, q = _row(rng, p)
    q = max(q, 2)
    return either(rng, f"{d * q} ÷ {d} = ?", q, near(rng, q, 1, 12), f"{d} × {q} = {d * q}, also ist {d * q} ÷ {d} = {q}.",
                  meta=_meta(f"{d * q}/{d}", q))


def divide_missing(rng, p):
    d, q = _row(rng, p)
    q = max(q, 2)
    return either(rng, f"{d * q} ÷ ▢ = {q}", d, near(rng, d, 1, 12), f"{d * q} ÷ {q} = {d}, also fehlt die {d}.",
                  meta=_meta(f"{d * q}/{q}", d))


def fact_family(rng, p):
    a, b = rng.randint(2, 9), rng.randint(2, 9)
    p_ = a * b
    return either(rng, f"Wenn {a} × {b} = {p_} ist, wie viel ist dann {p_} ÷ {b}?", a, near(rng, a, 1, 12, extra=[b]),
                  f"Teilen ist die Umkehrung von Malnehmen: {p_} ÷ {b} = {a}.", meta=_meta(f"{p_}/{b}", a))


def divide_word(rng, p):
    d, q = _row(rng, p)
    q = max(q, 2)
    thing = rng.choice(["Bonbons", "Kekse", "Sticker", "Karten", "Murmeln"])
    group, each = rng.choice([("Kinder", "jedes Kind"), ("Freunde", "jeder Freund"), ("Gäste", "jeder Gast")])
    return either(rng, f"{d * q} {thing} werden gerecht auf {d} {group} verteilt. Wie viele {thing} bekommt {each}?", q,
                  near(rng, q, 1, 15), f"{d * q} ÷ {d} = {q}.", meta=_meta(f"{d * q}/{d}", q))


def remainder(rng, p):
    d = rng.randint(2, 9)
    q = rng.randint(2, 9)
    r = rng.randint(1, d - 1)
    n = d * q + r
    return either(rng, f"{n} ÷ {d} = {q} Rest ▢", r, near(rng, r, 0, d, extra=[d - r]),
                  f"{d} × {q} = {d * q}, bis {n} fehlen noch {r}. Das ist der Rest.", meta=_meta(f"{n}-{d}*{q}", r))


# --------------------------------------------------------------------------------- unit 5: fractions

def frac_visual(rng, p):
    d = rng.choice(p.get("dens", [2, 3, 4, 6, 8]))
    n = rng.randint(1, d - 1)
    candidates = [(d - n, d), (n, d + 1), (n + 1, d), (n - 1, d), (n, d + 2), (n + 1, d + 2), (n, d - 1), (d - n, d + 1)]
    wrong = [frac(a, b) for a, b in candidates if 0 < a < b and Fraction(a, b) != Fraction(n, d)]
    kind = rng.choice(["pie", "bar"])
    return choice(rng, "Welcher Bruch ist gefärbt?", frac(n, d), wrong,
                  f"Das Ganze ist in {d} gleiche Teile geteilt, davon sind {n} gefärbt: {n}/{d}.",
                  visual={"kind": kind, "num": n, "den": d}, meta=_meta(f"{n}/{d}", Fraction(n, d)))


def frac_of_number(rng, p):
    d = rng.choice(p.get("dens", [2, 3, 4, 5, 10]))
    n = rng.randint(1, min(d - 1, 3))
    unit = rng.randint(2, 8)
    whole = d * unit
    ans = n * unit
    text = f"Wie viel ist {frac(n, d)} von {whole}?"
    return either(rng, text, ans, near(rng, ans, 1, whole, extra=[unit, whole // 2]),
                  f"{whole} ÷ {d} = {unit}, mal {n} ergibt {ans}.", meta=_meta(f"{n}/{d}*{whole}", ans))


def frac_compare(rng, p):
    if rng.random() < 0.5:
        d = rng.randint(3, 12)
        a, b = rng.sample(range(1, d), 2)
        big = max(a, b)
        return choice(rng, f"Welcher Bruch ist größer: {frac(a, d)} oder {frac(b, d)}?", frac(big, d), [frac(min(a, b), d), "gleich groß"],
                      f"Gleicher Nenner ({d}): Der Bruch mit dem größeren Zähler ist größer, also {frac(big, d)}.",
                      meta=_meta(f"{big}/{d}", Fraction(big, d)))
    d1, d2 = rng.sample(range(2, 11), 2)
    best = min(d1, d2)
    return choice(rng, f"Welcher Bruch ist größer: {frac(1, d1)} oder {frac(1, d2)}?", frac(1, best), [frac(1, max(d1, d2)), "gleich groß"],
                  f"Je mehr gleiche Teile ein Ganzes hat, desto kleiner ist jedes Teil. {frac(1, best)} ist größer.",
                  meta=_meta(f"1/{best}", Fraction(1, best)))


def frac_equivalent(rng, p):
    d = rng.choice([2, 3, 4, 5])
    n = rng.randint(1, d - 1)
    if gcd(n, d) != 1:
        n = 1
    k = rng.randint(2, 4)
    return either(rng, f"{frac(n, d)} = ▢/{d * k}", n * k, near(rng, n * k, 1, d * k),
                  f"Erweitere mit {k}: Zähler und Nenner mal {k}. {n} × {k} = {n * k}.", meta=_meta(f"{n}*{k}", n * k))


def frac_add(rng, p):
    d = rng.randint(3, 12)
    a = rng.randint(1, d - 2)
    b = rng.randint(1, d - a - 1) if d - a - 1 >= 1 else 1
    s = a + b
    if s >= d:
        b = d - a - 1 or 1
        s = a + b
    wrong = [frac(s, 2 * d), frac(s + 1, d), frac(a * b, d), frac(abs(a - b) or 1, d)]
    return choice(rng, f"{frac(a, d)} + {frac(b, d)} = ?", frac(s, d), wrong,
                  f"Bei gleichem Nenner rechnest du nur die Zähler: {a} + {b} = {s}. Der Nenner {d} bleibt.",
                  meta=_meta(f"{a}/{d}+{b}/{d}", Fraction(s, d)))


def frac_simplify(rng, p):
    d = rng.choice([2, 3, 4, 5])
    n = rng.randint(1, d - 1)
    while gcd(n, d) != 1:
        n = rng.randint(1, d - 1)
    k = rng.randint(2, 4)
    big = frac(n * k, d * k)
    return choice(rng, f"Kürze {big} so weit wie möglich.", frac(n, d), [frac(n * k, d), frac(n, d * k), frac(n + 1, d + 1)],
                  f"Teile Zähler und Nenner durch {k}: {n * k} ÷ {k} = {n} und {d * k} ÷ {k} = {d}.",
                  meta=_meta(f"{n}/{d}", Fraction(n, d)))


def frac_match(rng, p):
    bases = rng.sample([(1, 2), (1, 3), (1, 4), (2, 3), (3, 4), (1, 5)], 4)
    pairs = []
    for n, d in bases:
        k = rng.randint(2, 4)
        pairs.append((frac(n, d), frac(n * k, d * k)))
    return matching(rng, "Welche Brüche sind gleich viel wert?", pairs, "Erweitere oder kürze, bis Zähler und Nenner zusammenpassen.")


# ------------------------------------------------------------------------- unit 6: decimals, percent

def dec_place(rng, p):
    whole = rng.randint(1, 9)
    t, h = rng.randint(1, 9), rng.randint(1, 9)
    number = f"{whole},{t}{h}"
    which = rng.choice(["Zehntel", "Hundertstel"])
    digit = t if which == "Zehntel" else h
    return choice(rng, f"Welche Ziffer steht bei {number} an der {which}stelle?", digit, [d for d in (whole, t, h) if d != digit] + [(digit + 1) % 10],
                  f"Die erste Stelle nach dem Komma sind die Zehntel, die zweite die Hundertstel. In {number}: Zehntel {t}, Hundertstel {h}.",
                  meta=_meta(str(digit), digit))


def dec_add(rng, p):
    a, b = rng.randint(5, 80), rng.randint(5, 80)
    if rng.random() < 0.5:
        s = a + b
        return either(rng, f"{dec(a)} + {dec(b)} = ?", dec(s, trim=True), [dec(s + d, trim=True) for d in (1, -1, 10, -10)],
                      f"Schreibe Komma unter Komma: {dec(a)} + {dec(b)} = {dec(s, trim=True)}.", meta=_meta(f"{a}/10+{b}/10", Fraction(s, 10)))
    if a == b:
        a += 1
    if a < b:
        a, b = b, a
    d = a - b
    return either(rng, f"{dec(a)} − {dec(b)} = ?", dec(d, trim=True), [dec(d + k, trim=True) for k in (1, -1, 10, -10) if d + k >= 0],
                  f"Schreibe Komma unter Komma: {dec(a)} − {dec(b)} = {dec(d, trim=True)}.", meta=_meta(f"{a}/10-{b}/10", Fraction(d, 10)))


def dec_compare(rng, p):
    a = rng.randint(1, 9)
    x, y = rng.randint(1, 9), rng.randint(10, 99)
    left, right = f"{a},{x}", f"{a},{y:02d}"
    lv, rv = Fraction(x, 10), Fraction(y, 100)
    if lv == rv:
        right = f"{a},{y + 1:02d}"
        rv = Fraction(y + 1, 100)
    best = left if lv > rv else right
    return choice(rng, f"Welche Zahl ist größer: {left} oder {right}?", best, [right if best == left else left, "gleich groß"],
                  f"{left} = {a},{x}0. Vergleiche Stelle für Stelle von links: {best} ist größer.", meta=_meta(best.replace(",", "."), Fraction(best.replace(",", "."))))


def percent_of(rng, p):
    pct = rng.choice([10, 20, 25, 50, 75])
    base = {10: 10, 20: 5, 25: 4, 50: 2, 75: 4}[pct] * rng.randint(2, 12)
    ans = base * pct // 100
    hints = {10: "10 % ist ein Zehntel: durch 10 teilen.", 20: "20 % ist ein Fünftel: durch 5 teilen.",
             25: "25 % ist ein Viertel: durch 4 teilen.", 50: "50 % ist die Hälfte: durch 2 teilen.", 75: "75 % sind drei Viertel: durch 4 teilen, mal 3."}
    return either(rng, f"Wie viel sind {pct} % von {base}?", ans, near(rng, ans, 1, base, extra=[base // 2]),
                  f"{hints[pct]} Ergebnis: {ans}.", meta=_meta(f"{pct}/100*{base}", ans))


def percent_convert(rng, p):
    table = [("1/2", "50 %", "0,5"), ("1/4", "25 %", "0,25"), ("3/4", "75 %", "0,75"), ("1/10", "10 %", "0,1"), ("1/5", "20 %", "0,2")]
    fr_text, pct_text, dec_text = rng.choice(table)
    kind = rng.randint(0, 2)
    others = [t for t in table if t[0] != fr_text]
    rng.shuffle(others)
    value = Fraction(fr_text)
    if kind == 0:
        return choice(rng, f"{fr_text} entspricht wie viel Prozent?", pct_text, [o[1] for o in others], f"{fr_text} = {pct_text}.",
                      meta=_meta(f"{value.numerator}/{value.denominator}*100", value * 100))
    if kind == 1:
        return choice(rng, f"{pct_text} als Dezimalzahl ist …", dec_text, [o[2] for o in others] + ["1,5"], f"{pct_text} = {dec_text}.",
                      meta=_meta(f"{pct_text.split()[0]}/100", value))
    return choice(rng, f"{dec_text} als Bruch ist …", fr_text, [o[0] for o in others], f"{dec_text} = {fr_text}.",
                  meta=_meta(dec_text.replace(",", "."), value))


def percent_match(rng, p):
    table = rng.sample([("50 %", "1/2"), ("25 %", "1/4"), ("75 %", "3/4"), ("10 %", "0,1"), ("20 %", "1/5"), ("100 %", "das Ganze")], 4)
    return matching(rng, "Ordne die Prozente zu.", table, "Prozent heißt „von hundert“: 50 % sind die Hälfte, 25 % ein Viertel, 10 % ein Zehntel.")


# ------------------------------------------------------------------------------- unit 7: negatives, rules

def neg_compare(rng, p):
    a, b = rng.sample(range(-12, 13), 2)
    big = max(a, b)
    return choice(rng, f"Welche Zahl ist größer: {sgn(a)} oder {sgn(b)}?", sgn(big), [sgn(min(a, b))],
                  f"Auf dem Zahlenstrahl liegt {sgn(big)} weiter rechts, also ist {sgn(big)} größer.", meta=_meta(str(big), big))


def neg_add_sub(rng, p):
    a = rng.randint(-9, 9)
    b = rng.randint(1, 9)
    plus = rng.random() < 0.5
    res = a + b if plus else a - b
    sign = "+" if plus else MINUS
    steps = f"Starte bei {sgn(a)} und gehe {b} Schritte nach {'rechts' if plus else 'links'}: {sgn(res)}."
    return either(rng, f"{sgn(a)} {sign} {b} = ?", sgn(res), [sgn(res + d) for d in (1, -1, 2, -2, 10)] + [sgn(-res)],
                  steps, meta=_meta(f"{a}{'+' if plus else '-'}{b}", res), typed_odds=0.4)


def neg_order(rng, p):
    return sort_numbers(rng, {"min": -10, "max": 10, "count": 4})


def order_ops(rng, p):
    a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(2, 9)
    if rng.random() < 0.5:
        res = a + b * c
        return either(rng, f"{a} + {b} × {c} = ?", res, near(rng, res, 0, 100, extra=[(a + b) * c]),
                      f"Punkt vor Strich: erst {b} × {c} = {b * c}, dann {a} + {b * c} = {res}.", meta=_meta(f"{a}+{b}*{c}", res))
    if a * b <= c:
        a, b = c + 2, 2
    res = a * b - c
    return either(rng, f"{a} × {b} − {c} = ?", res, near(rng, res, 0, 100, extra=[a * (b - c) if b > c else a + b - c]),
                  f"Punkt vor Strich: erst {a} × {b} = {a * b}, dann {a * b} − {c} = {res}.", meta=_meta(f"{a}*{b}-{c}", res))


def parens(rng, p):
    a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(2, 6)
    res = (a + b) * c
    return either(rng, f"({a} + {b}) × {c} = ?", res, near(rng, res, 0, 150, extra=[a + b * c]),
                  f"Klammern zuerst: {a} + {b} = {a + b}, dann {a + b} × {c} = {res}.", meta=_meta(f"({a}+{b})*{c}", res))


def powers(rng, p):
    base, exp = rng.choice([(2, 2), (3, 2), (4, 2), (5, 2), (6, 2), (10, 2), (2, 3), (3, 3), (10, 3), (2, 4)])
    res = base ** exp
    return either(rng, f"{base}{'²' if exp == 2 else '³' if exp == 3 else '⁴'} = ?", res, near(rng, res, 1, 1100, extra=[base * exp]),
                  f"{base} hoch {exp} heißt {' × '.join([str(base)] * exp)} = {res}.", meta=_meta(f"{base}**{exp}", res))


# ----------------------------------------------------------------------------------- unit 8: equations

def solve_lin(rng, p):
    kind = rng.choice(p.get("kinds", ["add", "sub", "mul"]))
    x = rng.randint(2, 15)
    if kind == "add":
        b = rng.randint(2, 20)
        return either(rng, f"x + {b} = {x + b}", x, near(rng, x, 0, 40), f"Rechne rückwärts: {x + b} − {b} = {x}.", unit="x =", meta=_meta(f"{x + b}-{b}", x))
    if kind == "sub":
        b = rng.randint(2, 12)
        return either(rng, f"x − {b} = {x}", x + b, near(rng, x + b, 0, 40), f"Rechne rückwärts: {x} + {b} = {x + b}.", unit="x =", meta=_meta(f"{x}+{b}", x + b))
    m = rng.randint(2, 9)
    return either(rng, f"{m}x = {m * x}", x, near(rng, x, 1, 40), f"Teile beide Seiten durch {m}: {m * x} ÷ {m} = {x}.", unit="x =", meta=_meta(f"{m * x}/{m}", x))


def solve_two_step(rng, p):
    m, x, b = rng.randint(2, 6), rng.randint(2, 12), rng.randint(1, 15)
    if rng.random() < 0.5:
        return either(rng, f"{m}x + {b} = {m * x + b}", x, near(rng, x, 0, 40), f"Erst − {b}: {m * x}. Dann ÷ {m}: {x}.", unit="x =", meta=_meta(f"({m * x + b}-{b})/{m}", x))
    return either(rng, f"{m}x − {b} = {m * x - b}", x, near(rng, x, 0, 40), f"Erst + {b}: {m * x}. Dann ÷ {m}: {x}.", unit="x =", meta=_meta(f"({m * x - b}+{b})/{m}", x))


def box_equation(rng, p):
    a = rng.randint(1, 20)
    b = rng.randint(1, 20)
    if rng.random() < 0.5:
        return either(rng, f"▢ + {a} = {a + b}", b, near(rng, b, 0, 40), f"{a + b} − {a} = {b}.", meta=_meta(f"{a + b}-{a}", b))
    m = rng.randint(2, 9)
    return either(rng, f"▢ × {m} = {m * b}", b, near(rng, b, 1, 40), f"{m * b} ÷ {m} = {b}.", meta=_meta(f"{m * b}/{m}", b))


def word_equation(rng, p):
    x = rng.randint(2, 15)
    kind = rng.randint(0, 2)
    if kind == 0:
        b = rng.randint(2, 12)
        return either(rng, f"Ich denke mir eine Zahl und addiere {b}. Dann habe ich {x + b}. Welche Zahl war es?", x, near(rng, x, 0, 40),
                      f"x + {b} = {x + b}, also x = {x + b} − {b} = {x}.", meta=_meta(f"{x + b}-{b}", x))
    if kind == 1:
        m = rng.randint(2, 6)
        return either(rng, f"Ich denke mir eine Zahl und multipliziere sie mit {m}. Dann habe ich {x * m}. Welche Zahl war es?", x, near(rng, x, 1, 40),
                      f"{m}x = {x * m}, also x = {x * m} ÷ {m} = {x}.", meta=_meta(f"{x * m}/{m}", x))
    b = rng.randint(2, 9)
    return either(rng, f"Ich denke mir eine Zahl und ziehe {b} ab. Dann habe ich {x}. Welche Zahl war es?", x + b, near(rng, x + b, 0, 40),
                  f"x − {b} = {x}, also x = {x} + {b} = {x + b}.", meta=_meta(f"{x}+{b}", x + b))


def solve_choice(rng, p):
    x = rng.randint(2, 12)
    m, b = rng.randint(2, 5), rng.randint(1, 9)
    return choice(rng, f"Welche Zahl macht die Gleichung wahr? {m}x + {b} = {m * x + b}", x, near(rng, x, 0, 30),
                  f"Probe: {m} × {x} + {b} = {m * x + b}. Das stimmt.", meta=_meta(f"({m * x + b}-{b})/{m}", x))


# ----------------------------------------------------------------------------------- unit 9: geometry

def rect_perimeter(rng, p):
    w, h = rng.randint(2, 12), rng.randint(2, 9)
    return either(rng, f"Wie groß ist der Umfang des Rechtecks? ({w} cm × {h} cm)", 2 * (w + h), near(rng, 2 * (w + h), 4, 80, extra=[w * h, w + h]),
                  f"Umfang = 2 × (a + b) = 2 × ({w} + {h}) = {2 * (w + h)} cm.", unit="cm", visual={"kind": "rect", "w": w, "h": h}, meta=_meta(f"2*({w}+{h})", 2 * (w + h)))


def rect_area(rng, p):
    w, h = rng.randint(2, 12), rng.randint(2, 9)
    return either(rng, f"Wie groß ist die Fläche des Rechtecks? ({w} cm × {h} cm)", w * h, near(rng, w * h, 4, 150, extra=[2 * (w + h), w + h]),
                  f"Fläche = a × b = {w} × {h} = {w * h} cm².", unit="cm²", visual={"kind": "rect", "w": w, "h": h}, meta=_meta(f"{w}*{h}", w * h))


def triangle_area(rng, p):
    base, height = rng.randint(2, 12), rng.randint(2, 12)
    if (base * height) % 2:
        height += 1
    area = base * height // 2
    return either(rng, f"Wie groß ist die Fläche des Dreiecks? (Grundseite {base} cm, Höhe {height} cm)", area,
                  near(rng, area, 1, 100, extra=[base * height]), f"Fläche = Grundseite × Höhe ÷ 2 = {base} × {height} ÷ 2 = {area} cm².", unit="cm²",
                  visual={"kind": "triangle", "base": base, "height": height}, meta=_meta(f"{base}*{height}/2", area))


def angle_sum(rng, p):
    a, b = rng.randint(30, 90), rng.randint(30, 80)
    c = 180 - a - b
    return either(rng, f"Ein Dreieck hat die Winkel {a}° und {b}°. Wie groß ist der dritte Winkel?", c, near(rng, c, 5, 120, extra=[a + b, 360 - a - b]),
                  f"Die Winkel im Dreieck ergeben zusammen 180°: 180 − {a} − {b} = {c}.", unit="°", meta=_meta(f"180-{a}-{b}", c))


def unit_convert(rng, p):
    kind = rng.choice([("m", "cm", 100), ("km", "m", 1000), ("cm", "mm", 10)])
    big, small, factor = kind
    n = rng.randint(2, 9)
    if rng.random() < 0.5:
        return either(rng, f"{n} {big} = ▢ {small}", n * factor, [n * factor * 10, n * factor // 10, n + factor, n * 10], f"1 {big} sind {factor} {small}: {n} × {factor} = {n * factor}.",
                      unit=small, meta=_meta(f"{n}*{factor}", n * factor))
    return either(rng, f"{n * factor} {small} = ▢ {big}", n, near(rng, n, 1, 20, extra=[n * 10]), f"{factor} {small} sind 1 {big}: {n * factor} ÷ {factor} = {n}.",
                  unit=big, meta=_meta(f"{n * factor}/{factor}", n))


def geometry_match(rng, p):
    table = [("Umfang Rechteck", "2 × (a + b)"), ("Fläche Rechteck", "a × b"), ("Fläche Dreieck", "g × h ÷ 2"),
             ("Winkelsumme Dreieck", "180°"), ("Fläche Quadrat", "a × a")]
    return matching(rng, "Welche Formel gehört dazu?", rng.sample(table, 4), "Merke dir die Formeln: Umfang ist rundherum, Fläche ist innen.")


FAMILIES = {f.__name__: f for f in (
    count_dots, compare_sign, bigger_number, neighbor, add, sub, missing_addend, make_ten, match_calc, sort_numbers,
    word_addsub, place_value, add_tens, round_tens, times, times_missing, times_array, times_word, multiples, divide,
    divide_missing, fact_family, divide_word, remainder, frac_visual, frac_of_number, frac_compare, frac_equivalent,
    frac_add, frac_simplify, frac_match, dec_place, dec_add, dec_compare, percent_of, percent_convert, percent_match,
    neg_compare, neg_add_sub, neg_order, order_ops, parens, powers, solve_lin, solve_two_step, box_equation,
    word_equation, solve_choice, rect_perimeter, rect_area, triangle_area, angle_sum, unit_convert, geometry_match,
)}


# ------------------------------------------------------------------------------------- curriculum

def M(name, weight=1, **params):
    return (name, params, weight)


UNITS = [
    {"id": 1, "title": "Zahlen bis 20", "desc": "Zählen, vergleichen, plus und minus", "color": "blue", "lessons": [
        {"title": "Zahlen kennen", "icon": "star", "mix": [M("count_dots", 3, max=10), M("bigger_number", 2, max=20), M("compare_sign", 2, max=20), M("neighbor", 2, max=20)]},
        {"title": "Plus bis 10", "icon": "plus", "mix": [M("add", 4, max=10), M("missing_addend", 2, max=10), M("make_ten", 2), M("match_calc", 1, op="add", max=10)]},
        {"title": "Minus bis 10", "icon": "minus", "mix": [M("sub", 4, max=10), M("word_addsub", 2, max=10), M("match_calc", 1, op="sub", max=10)]},
        {"title": "Plus und Minus bis 20", "icon": "plusminus", "mix": [M("add", 3, max=20), M("sub", 3, max=20), M("missing_addend", 2, max=20), M("word_addsub", 1, max=20)]},
    ]},
    {"id": 2, "title": "Rechnen bis 100", "desc": "Zehner, Einer und größere Aufgaben", "color": "purple", "lessons": [
        {"title": "Zehner und Einer", "icon": "star", "mix": [M("place_value", 4), M("neighbor", 1, max=99), M("sort_numbers", 2, max=100)]},
        {"title": "Zehner rechnen", "icon": "plus", "mix": [M("add_tens", 4), M("round_tens", 2), M("match_calc", 1, op="add", max=100)]},
        {"title": "Plus bis 100", "icon": "plus", "mix": [M("add", 4, max=100, min=11), M("word_addsub", 2, max=100)]},
        {"title": "Minus bis 100", "icon": "minus", "mix": [M("sub", 4, max=100), M("word_addsub", 2, max=100)]},
    ]},
    {"id": 3, "title": "Das Einmaleins", "desc": "Malnehmen, Reihen und Muster", "color": "orange", "lessons": [
        {"title": "2er, 5er und 10er", "icon": "times", "mix": [M("times", 4, rows=[2, 5, 10]), M("times_array", 2), M("multiples", 2, rows=[2, 5, 10])]},
        {"title": "3er und 4er", "icon": "times", "mix": [M("times", 4, rows=[3, 4]), M("times_missing", 2, rows=[3, 4]), M("times_word", 2, rows=[3, 4])]},
        {"title": "6er und 7er", "icon": "times", "mix": [M("times", 4, rows=[6, 7]), M("times_missing", 2, rows=[6, 7]), M("match_calc", 1, op="times", rows=[6, 7])]},
        {"title": "8er und 9er", "icon": "times", "mix": [M("times", 4, rows=[8, 9]), M("times_missing", 2, rows=[8, 9]), M("times_word", 2, rows=[8, 9])]},
    ]},
    {"id": 4, "title": "Teilen", "desc": "Gerecht verteilen und Umkehraufgaben", "color": "pink", "lessons": [
        {"title": "Teilen durch 2, 5, 10", "icon": "divide", "mix": [M("divide", 4, rows=[2, 5, 10]), M("divide_word", 2, rows=[2, 5, 10]), M("divide_missing", 1, rows=[2, 5, 10])]},
        {"title": "Teilen durch 3 und 4", "icon": "divide", "mix": [M("divide", 4, rows=[3, 4]), M("divide_missing", 2, rows=[3, 4]), M("fact_family", 1)]},
        {"title": "Größere Reihen", "icon": "divide", "mix": [M("divide", 4, rows=[6, 7, 8, 9]), M("fact_family", 2), M("match_calc", 1, op="divide", rows=[6, 7, 8, 9])]},
        {"title": "Rest und Textaufgaben", "icon": "divide", "mix": [M("remainder", 3), M("divide_word", 3, rows=[3, 4, 6, 8]), M("fact_family", 1)]},
    ]},
    {"id": 5, "title": "Brüche", "desc": "Teile von einem Ganzen", "color": "cyan", "lessons": [
        {"title": "Brüche erkennen", "icon": "pie", "mix": [M("frac_visual", 5)]},
        {"title": "Bruchteile von Zahlen", "icon": "pie", "mix": [M("frac_of_number", 5), M("frac_visual", 2)]},
        {"title": "Brüche vergleichen", "icon": "pie", "mix": [M("frac_compare", 4), M("frac_visual", 1, dens=[2, 4, 8])]},
        {"title": "Erweitern und Kürzen", "icon": "pie", "mix": [M("frac_equivalent", 3), M("frac_simplify", 3), M("frac_match", 1)]},
        {"title": "Brüche addieren", "icon": "pie", "mix": [M("frac_add", 5), M("frac_compare", 1)]},
    ]},
    {"id": 6, "title": "Dezimalzahlen und Prozent", "desc": "Komma und Prozentzeichen", "color": "indigo", "lessons": [
        {"title": "Das Komma verstehen", "icon": "decimal", "mix": [M("dec_place", 3), M("dec_compare", 3)]},
        {"title": "Mit Komma rechnen", "icon": "decimal", "mix": [M("dec_add", 5), M("dec_compare", 1)]},
        {"title": "Prozent erkennen", "icon": "percent", "mix": [M("percent_convert", 4), M("percent_match", 2)]},
        {"title": "Prozent berechnen", "icon": "percent", "mix": [M("percent_of", 5), M("percent_convert", 1)]},
    ]},
    {"id": 7, "title": "Negative Zahlen und Rechenregeln", "desc": "Unter null und Punkt vor Strich", "color": "red", "lessons": [
        {"title": "Negative Zahlen", "icon": "minus", "mix": [M("neg_compare", 3), M("neg_order", 2)]},
        {"title": "Plus und Minus unter null", "icon": "plusminus", "mix": [M("neg_add_sub", 5), M("neg_compare", 1)]},
        {"title": "Punkt vor Strich", "icon": "times", "mix": [M("order_ops", 5)]},
        {"title": "Klammern und Hochzahlen", "icon": "times", "mix": [M("parens", 3), M("powers", 3), M("order_ops", 1)]},
    ]},
    {"id": 8, "title": "Gleichungen", "desc": "Dem x auf der Spur", "color": "violet", "lessons": [
        {"title": "Lücken füllen", "icon": "x", "mix": [M("box_equation", 5), M("solve_lin", 1, kinds=["add"])]},
        {"title": "x finden", "icon": "x", "mix": [M("solve_lin", 5), M("solve_choice", 1)]},
        {"title": "Zwei Schritte", "icon": "x", "mix": [M("solve_two_step", 5), M("solve_choice", 2)]},
        {"title": "Zahlenrätsel", "icon": "x", "mix": [M("word_equation", 5), M("solve_lin", 1)]},
    ]},
    {"id": 9, "title": "Geometrie", "desc": "Umfang, Fläche und Winkel", "color": "gold", "lessons": [
        {"title": "Umfang", "icon": "ruler", "mix": [M("rect_perimeter", 5), M("unit_convert", 1)]},
        {"title": "Fläche", "icon": "ruler", "mix": [M("rect_area", 4), M("rect_perimeter", 2)]},
        {"title": "Dreiecke", "icon": "ruler", "mix": [M("triangle_area", 3), M("angle_sum", 3)]},
        {"title": "Maße umrechnen", "icon": "ruler", "mix": [M("unit_convert", 4), M("geometry_match", 1), M("rect_area", 1)]},
    ]},
]

# Every unit ends with a test that mixes the unit's lessons, and a trophy marks it on the path.
for _unit in UNITS:
    _mix = [entry for lesson in _unit["lessons"] for entry in lesson["mix"]]
    _unit["lessons"].append({"title": "Meistertest", "icon": "trophy", "mix": _mix, "test": True})
    for _n, _lesson in enumerate(_unit["lessons"], start=1):
        _lesson["id"] = f"{_unit['id']}-{_n}"
        _lesson["unit"] = _unit["id"]

LESSONS = {lesson["id"]: lesson for unit in UNITS for lesson in unit["lessons"]}


def public_curriculum():
    """What the page needs to draw the path (no generator details)."""
    return [{"id": u["id"], "title": u["title"], "desc": u["desc"], "color": u["color"], "character": CAST[(u["id"] - 1) % len(CAST)],
             "lessons": [{"id": l["id"], "title": l["title"], "icon": l["icon"], "test": bool(l.get("test"))} for l in u["lessons"]]}
            for u in UNITS]


# ------------------------------------------------------------------------------------- generation

def _signature(exercise):
    return (exercise["type"], exercise["prompt"], tuple(exercise.get("options") or ()), tuple(map(tuple, exercise.get("pairs") or ())),
            tuple(exercise.get("tokens") or ()))


def generate(mix, count, rng):
    """`count` different exercises from the weighted families of a lesson; the same family at most twice in a row."""
    out, seen, last, attempts = [], set(), [], 0
    names = [name for name, _, _ in mix]
    weights = [weight for _, _, weight in mix]
    while len(out) < count and attempts < count * 60:
        attempts += 1
        name, params, _ = mix[rng.choices(range(len(mix)), weights)[0]]
        if len(names) > 1 and last[-2:] == [name, name]:
            continue
        exercise = FAMILIES[name](rng, params)
        sig = _signature(exercise)
        if sig in seen:
            continue
        seen.add(sig)
        exercise["family"] = name
        out.append(exercise)
        last.append(name)
    return out


def public(exercise):
    return {k: v for k, v in exercise.items() if not k.startswith("_") and v not in (None, "")}


SPOKEN_ANSWER_RE = re.compile(r"[\u2212-]?\d+(,\d+)?")


def to_speak(exercise):
    """The same question as a "say it out loud" exercise (only typed number answers can be said)."""
    spoken = dict(exercise)
    spoken["type"] = "speak"
    is_sum = not re.search(r"[A-Za-zÄÖÜäöüß]{4,}", exercise["prompt"])      # "6 × 7 = ?" versus a word problem
    spoken["prompt"] = ("Sag die Lösung laut: " if is_sum else "Sag deine Antwort laut. ") + exercise["prompt"]
    return spoken


def make_speakable(exercises, how_many, rng):
    """Turn up to `how_many` typed exercises (never the first two) into speaking exercises, in place."""
    eligible = [i for i, e in enumerate(exercises) if i >= 2 and e["type"] == "input" and SPOKEN_ANSWER_RE.fullmatch(e["answer"])]
    for i in rng.sample(eligible, min(how_many, len(eligible))):
        exercises[i] = to_speak(exercises[i])
    return exercises


def lesson_exercises(lesson_id, seed, speak=False):
    lesson = LESSONS[lesson_id]
    rng = random.Random(seed)
    exercises = generate(lesson["mix"], TEST_LENGTH if lesson.get("test") else LESSON_LENGTH, rng)
    if speak:
        make_speakable(exercises, SPEAK_PER_TEST if lesson.get("test") else SPEAK_PER_LESSON, rng)
    return exercises


def practice_exercises(max_unit, count, seed, speak=False):
    """A mixed practice round over every unit up to `max_unit`."""
    rng = random.Random(seed)
    mix = [entry for unit in UNITS if unit["id"] <= max_unit for lesson in unit["lessons"] if not lesson.get("test") for entry in lesson["mix"]]
    exercises = generate(mix, count, rng)
    if speak:
        make_speakable(exercises, 1, rng)
    return exercises


def placement_exercises(seed):
    """For the placement test: a few typed or multiple-choice questions for every unit (the page walks up and down
    the units depending on the answers). Returns [(unit id, exercise), ...] with the private _meta still on."""
    rng = random.Random(seed)
    out = []
    for unit in UNITS:
        mix = [entry for lesson in unit["lessons"] if not lesson.get("test") for entry in lesson["mix"]]
        weights = [weight for _, _, weight in mix]
        seen, picked, attempts = set(), 0, 0
        while picked < PLACEMENT_PER_UNIT and attempts < 200:
            attempts += 1
            name, params, _ = mix[rng.choices(range(len(mix)), weights)[0]]
            exercise = FAMILIES[name](rng, params)
            signature = _signature(exercise)
            if exercise["type"] not in ("choice", "input") or signature in seen:
                continue
            seen.add(signature)
            exercise["family"] = name
            out.append((unit["id"], exercise))
            picked += 1
    return out


# ----------------------------------------------------------------------------------------- routes

def static_url(path):
    """A static file's address with its modification time, so browsers fetch a changed file right away."""
    try:
        version = int(os.path.getmtime(os.path.join("static", *path.split("/"))))
    except OSError:
        version = 0
    return f"{url_for('static', filename=path)}?v={version}"


def base_url():
    """The site's own address as visitors see it (behind the host's proxy the scheme comes from a header)."""
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": "gomat – Mathe lernen", "short_name": "gomat", "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait",
        "background_color": "#ffffff", "theme_color": "#1cb0f6", "categories": ["education", "kids"],
        "icons": [
            {"src": "/static/img/gomat-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/gomat-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/gomat-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def register_routes(app):
    def seed_of(raw):
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return random.SystemRandom().randrange(2 ** 31)
        return value % (2 ** 31)

    @app.context_processor
    def gomat_template_helpers():
        return {"static_url": static_url}

    @app.after_request
    def gomat_headers(response):
        endpoint = request.endpoint
        if endpoint in PAGE_ENDPOINTS:
            response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Cache-Control"] = "no-cache"
        if endpoint in NO_COOKIE_ENDPOINTS:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=(), payment=(), usb=()"
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if endpoint in ("gomat_lesson", "gomat_practice", "gomat_placement"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/", endpoint="pl_home")
    def gomat_home():
        root = base_url()
        return render_template("gomat.html", units=public_curriculum(), lesson_length=LESSON_LENGTH, pass_mistakes=TEST_MAX_MISTAKES,
                               placement_questions=PLACEMENT_QUESTIONS, tagline=TAGLINE,
                               description=DESCRIPTION, base=root, og_image=f"{root}/static/img/gomat-og.png")

    def legal(page):
        # The archived song site (ysound) is only described while it can still be used or shows ads.
        ads = ysound.ads_config()
        return render_template("gomat_legal.html", page=page, imprint=ysound.imprint(), ads=ads, provider=ysound.provider(),
                               archive_active=ysound.provider() is not None or ads is not None)

    @app.route("/datenschutz")
    def gomat_privacy():
        return legal("privacy")

    @app.route("/impressum")
    def gomat_imprint():
        return legal("imprint")

    @app.route("/manifest.webmanifest")
    def gomat_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")

    @app.route("/robots.txt")
    def gomat_robots():
        lines = ["User-agent: *", "Allow: /", "Disallow: /api/"] + [f"Disallow: {path}" for path in ARCHIVE_PATHS]
        lines += ["", f"Sitemap: {base_url()}/sitemap.xml", ""]
        return Response("\n".join(lines), mimetype="text/plain")

    @app.route("/sitemap.xml")
    def gomat_sitemap():
        root = base_url()
        urls = "".join(f"  <url><loc>{root}{path}</loc></url>\n" for path in ("/", "/datenschutz", "/impressum"))
        return Response(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n',
                        mimetype="application/xml")

    @app.errorhandler(404)
    def gomat_not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "not_found"}), 404
        return render_template("gomat_error.html", code=404, mood="sad", title="Diese Seite gibt es nicht",
                               text="Vielleicht hat sich die Adresse geändert, oder sie war nie da. Gomi bringt dich zurück zum Lernen."), 404

    @app.route("/api/gomat/lesson/<lesson_id>")
    def gomat_lesson(lesson_id):
        if not LESSON_ID_RE.fullmatch(lesson_id) or lesson_id not in LESSONS:
            return jsonify({"ok": False, "error": "not_found"}), 404
        lesson = LESSONS[lesson_id]
        exercises = lesson_exercises(lesson_id, seed_of(request.args.get("seed")), speak=request.args.get("speak") == "1")
        return jsonify({"ok": True, "lesson": {"id": lesson_id, "title": lesson["title"], "unit": lesson["unit"]},
                        "exercises": [public(e) for e in exercises]})

    @app.route("/api/gomat/practice")
    def gomat_practice():
        try:
            max_unit = max(1, min(len(UNITS), int(request.args.get("max_unit", 1))))
            count = max(5, min(20, int(request.args.get("n", 10))))
        except ValueError:
            return jsonify({"ok": False, "error": "bad_request"}), 400
        exercises = practice_exercises(max_unit, count, seed_of(request.args.get("seed")), speak=request.args.get("speak") == "1")
        return jsonify({"ok": True, "exercises": [public(e) for e in exercises]})

    @app.route("/api/gomat/placement")
    def gomat_placement():
        questions = placement_exercises(seed_of(request.args.get("seed")))
        units = [{"unit": unit["id"], "exercises": [public(e) for u, e in questions if u == unit["id"]]} for unit in UNITS]
        return jsonify({"ok": True, "questions": PLACEMENT_QUESTIONS, "units": units})
