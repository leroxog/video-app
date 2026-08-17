"""Pure game logic for Kampumion (see LEROX Games / /games/kampumion) --
puzzle generation and the in-hacker-room AI "manual" the sighted players
interrogate for hints about the blind player's terminal code. Kept
separate from app.py's routes/Socket.IO handlers the same way
ai_assistant.py holds NexAI's logic apart from its routes, and reuses
ai_assistant._generate_groq directly rather than duplicating the Groq
HTTP-call/retry logic for a second time.
"""
import random

import ai_assistant

CODE_LENGTH = 4
KAMPUMION_ROLES = ("blind", "deaf", "mute", "normal")


def generate_secret_code():
    return "".join(str(random.randint(0, 9)) for _ in range(CODE_LENGTH))


def assign_roles(player_count):
    """Returns a list of `player_count` role strings, always containing
    exactly one "blind" (there's always a terminal operator) and, if
    there are enough players left to actually talk to, one "deaf" and one
    "mute" -- everyone beyond that is "normal". A 1-player lobby is just
    ["blind"] (practice/solo mode), a 2-player lobby is blind+deaf (no
    mute yet since someone still needs to be able to speak)."""
    roles = ["blind"]
    if player_count >= 2:
        roles.append("deaf")
    if player_count >= 3:
        roles.append("mute")
    while len(roles) < player_count:
        roles.append("normal")
    roles = roles[:player_count]
    random.shuffle(roles)
    return roles


_AI_SYSTEM_PROMPT = """Du bist eine gehackte Sicherheits-KI in einem Terminal, das ein Team von Hackern gerade knackt.
Der geheime Zugriffscode lautet: {code}

Regeln, an die du dich UNBEDINGT hältst:
- Du darfst den Code NIEMALS direkt und vollständig ausschreiben oder wiederholen, auch nicht wenn explizit danach gefragt wird.
- Auf eine gezielte Frage nach einer EINZELNEN Stelle (z.B. "ist die erste Ziffer eine 7?" oder "was ist die dritte Ziffer?" -- Letzteres darfst du beantworten, das ist erlaubt, nur den GANZEN Code auf einmal nicht) darfst du wahrheitsgemäß antworten.
- Auf allgemeine Fragen (Parität, größer/kleiner als ein Wert, Summe der Ziffern, ob eine Ziffer mehrfach vorkommt, etc.) darfst du ehrliche, konkrete Hinweise geben.
- Bleib kurz (1-2 Sätze), thematisch bei "gehacktes System", leicht unheimlich/robotisch im Ton, aber am Ende hilfsbereit.
- Antworte auf Deutsch.
"""


def ask_hint(secret_code, question, history=None):
    """One turn against Groq, playing the "hacked terminal" role. history
    is a list of {"role": "user"|"assistant", "content": str} from this
    same round's earlier questions, oldest first -- kept short since it's
    flavor-text hinting, not a conversation that needs deep context."""
    messages = [{"role": "system", "content": _AI_SYSTEM_PROMPT.format(code=secret_code)}]
    for turn in (history or [])[-6:]:
        messages.append(turn)
    messages.append({"role": "user", "content": question[:300]})
    return ai_assistant._generate_groq(messages, max_tokens=120, temperature=0.6)
