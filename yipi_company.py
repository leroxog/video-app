"""The official accounts of Satürn (2026-10-30). Two accounts belong to Satürn itself and nobody can get one: "Satürn-Web" (everything new about the website) and "Nex-AI" (everything new
about the AI). They are marked "Offiziell" next to their name, nobody can sign in as them (their password fits nothing), their handles are reserved, they read no messages, and
their posts show in everybody's "Für dich" feed; they are suggested under "Wem folgen" (nobody is made to follow them).

Every new feature gets a post on one of them: whoever adds something to Satürn adds a line to ANNOUNCEMENTS (below). The first request to the API after a start of the site makes the
accounts if they are missing and publishes the announcements that were not published yet (each id once; the table `yipi_announcement` remembers). So a release posts itself.

Rules for the texts: German, friendly, at most 280 characters, what the person can do now (not how it was built), at most two hashtags."""
import logging
import threading

from flask import request
from sqlalchemy.exc import IntegrityError

import yipi

log = logging.getLogger("nex.company")

ACCOUNTS = {
    "web": {"handle": "nexweb", "name": "Satürn-Web", "bio": "Das offizielle Konto von Satürn. Hier stehen alle Neuerungen der Webseite."},
    "ai": {"handle": "nexai", "name": "Nex-AI", "bio": "Das offizielle Konto von Nex AI. Hier stehen alle Neuerungen der KI."},
}
PASSWORD_HASH = "!"                          # fits no password: nobody can sign in as an official account

# (id, account, text): add new lines at the END; an id is never reused. The text is posted once, the first time the site runs with the line.
ANNOUNCEMENTS = [
    ("2026-10-30-web", "web", "Neu auf Satürn: Links zeigen eine Vorschau und öffnen sich direkt hier, ohne dass du Satürn verlässt. Videos im Feed laufen stumm von allein, und nach den ersten Beiträgen kommen fünf Shorts. Dazu ein neuer Start mit einfachem Anmelden und bunten Standardbildern. #neu"),
    ("2026-10-30-round", "web", "Neu auf Satürn: Videos halten mit einem Klick an und spielen mit einem Klick weiter. Es gibt keine Leiste zum Vor- und Zurückspulen und keinen Knopf mehr, um sie groß zu machen. Dazu sind jetzt auch die Leisten oben und unten, die Kamera und die Videos schön abgerundet. #neu"),
    ("2026-10-31-create", "web", "Neu in der Kamera: Der Knopf ganz links ist jetzt ein Plus. Dahinter erstellst du mit KI ein Spiel oder eine Linse oder lädst ein Spiel mit Name, Foto und Code hoch. Auf Home kommen im Querformat nach ein paar Beiträgen fünf Videos nebeneinander. #neu"),
    ("2026-10-31-lenses", "web", "Neu in der Kamera: Die Linsen sind jetzt echt 3D. Hüte, Brillen, Ohren und Zähne sitzen auf deinem Kopf und drehen sich mit, Augen werden genau vergrößert, und die Sturmhaube ist da. Jede Linse hat jetzt ein eigenes Bild. #neu"),
    ("2026-10-31-games", "web", "Neu in der Kamera: Das Auto-Rennen ist jetzt in echtem 3D, und dein Gesicht bleibt im Bild. Das Motorrad ist neu gezeichnet. Bei den Ranglisten rollt das Bild über deinem Kopf, und du kannst unter dem Plus eigene Ranglisten mit Bildern bauen. #neu"),
    ("2026-10-31-music", "web", "Neu in der Kamera: Oben rechts stellst du Kamera, Mikrofon und Ton ein. Du kannst Songs hinzufügen (frei benutzbare Musik), die Linse Zufalls-Song nutzen, und Linsen wirken auf mehrere Gesichter. Das Motorrad ist in 3D. #neu"),
    ("2026-10-31-sidebar", "web", "Neu auf Satürn: Am Computer gibt es eine große weiße Seitenleiste mit Suche, allen Seiten und deinem Konto. Auf dem iPhone und iPad: Satürn zum Home-Bildschirm hinzufügen, dann kommen Mitteilungen, auch wenn jemand, dem du folgst, etwas postet. #neu"),
    ("2026-10-31-composer", "web", "Neu auf Satürn: Über der Tastatur gibt es jetzt überall eine Zeile wie bei WhatsApp. Mit dem Plus öffnest du Fotos, Kamera, Standort, Kontakt, Dokument und Sticker, dazu Sticker-Knopf, Foto und Mikro für Sprachnachrichten. Die GIFs heißen jetzt Sticker. #neu"),
    ("2026-10-31-calls", "web", "Neu auf Satürn: Anrufe! Tippe im Chat auf den Hörer neben dem Namen und ruf Freunde oder eine Gruppe an. Es klingelt mit Ton und Benachrichtigung. Die Sprache läuft live, wird nie aufgenommen und 10 Sekunden nach dem Abspielen gelöscht. #anrufe #neu"),
    ("2026-10-31-reels", "web", "Neu in Videos: Die Knöpfe am Rand sehen aus wie bei TikTok, mit lila-pinkem Ring ums Profilbild und einem Plus, das beim Folgen aufpoppt. Werbung blockiert das Scrollen nicht mehr. Am Computer nutzt Satürn jetzt den ganzen Bildschirm. #videos #neu"),
    ("2026-10-31-saturn", "web", "Aus Nex wird Satürn! Die Seite hat einen neuen Namen und ein neues Zeichen: einen kleinen lila Planeten mit Ring. Dein Konto, deine Beiträge und deine Freunde sind alle noch da. Nex AI heißt weiter Nex AI. #neu"),
    ("2026-10-31-subtitles", "web", "Neu in Videos: automatische Untertitel in der Sprache des Videos und in 22 Sprachen, dazu eine Sprachspur: Eine Stimme liest die Übersetzung vor, bei einer Frau mit weiblicher, bei einem Mann mit männlicher Stimme. Tippe auf „Sprache“. #untertitel #neu"),
    ("2026-10-31-qr", "web", "Neu in der Kamera: Jedes Spiel und jede Linse hat ein QR-Symbol unter dem Ton-Knopf. Tippe darauf, dann siehst du den Code genau dieses Spiels, kannst ihn teilen oder speichern, und wer ihn scannt, spielt es sofort. Alle Linsen sind jetzt in 3D. #qr #neu"),
    ("2026-10-31-hearing", "web", "Untertitel und Sprachspur verstehen jetzt besser, auch bei leiser Stimme, Lärm und Musik. Sätze werden richtig zusammengesetzt. Wurde die Sprache deines Videos falsch erkannt? Tippe bei deinem Video auf „Sprache“ und wähle sie aus: Satürn hört noch einmal hin. #untertitel"),
    ("2026-10-31-camera", "web", "Neu in der Kamera: Ein Spiel startet sofort und wird gefilmt, die Leiste bleibt, und wer wegwischt, wirft die Aufnahme weg. Bei Linsen: Tippen = Foto, Halten = Video. Mit „Teilen“ geht beides an jede App. „Kamera“ im Chat öffnet die Satürn-Kamera. #neu #kamera"),
    ("2026-10-31-roast", "ai", "Neu: Nex AI im Modus Human ist jetzt ein Roast. Sie zieht dich auf und beleidigt dich frech, antwortet aber trotzdem richtig. Es bleibt ein Spaß: nichts gegen Herkunft, Religion oder Aussehen. Du wählst den Modus oben im Chat. #nexai"),
    ("2026-10-30-ai", "ai", "Neu: Nex AI hat jetzt vier Modi. Normal, Superintelligent (längere, gründlichere Antworten), Human (locker und direkt) und Code (für gute Programme). Du wählst sie oben im Chat. #nexai"),
    ("2026-10-31-aigames", "ai", "Neu: Nex AI baut Spiele. Sag ihr im Chat, was für ein Spiel du willst, und unter dem Code erscheint der Knopf „Als Spiel hochladen“. Dann steht es in der Kamera und alle können es spielen. Du kannst auch in der Kamera unter dem Plus „Mit KI erstellen“ wählen. #nexai"),
]

_state = {"started": False}
_lock = threading.Lock()


# ------------------------------------------------------------------------------------------------------------------ the accounts
def official(kind):
    """The account of the kind "web" or "ai", made when it is missing."""
    spec = ACCOUNTS[kind]
    user = yipi.YipiUser.query.filter_by(handle_lc=spec["handle"]).first()
    if user is None:
        user = yipi.YipiUser(handle=spec["handle"], handle_lc=spec["handle"], name=spec["name"], bio=spec["bio"], password_hash=PASSWORD_HASH, company=True, last_seen_at=yipi.utcnow())
        yipi.db.session.add(user)
        try:
            yipi.db.session.commit()
        except IntegrityError:
            yipi.db.session.rollback()
            user = yipi.YipiUser.query.filter_by(handle_lc=spec["handle"]).first()
    elif not user.company or user.password_hash != PASSWORD_HASH or user.name != spec["name"] or user.bio != spec["bio"]:
        user.company = True
        user.password_hash = PASSWORD_HASH
        user.name = spec["name"]                         # (the name and the line under it are the site's to decide: "Nex-Web" became "Satürn-Web")
        user.bio = spec["bio"]
        yipi.db.session.commit()
    return user


def official_ids():
    return [official(kind).id for kind in ACCOUNTS]


# ------------------------------------------------------------------------------------------------------------------ the announcements
def post_as(user, text):
    post = yipi.YipiPost(user_id=user.id, text=text)
    yipi.db.session.add(post)
    yipi.db.session.flush()
    for tag in yipi.extract_tags(text):
        yipi.db.session.add(yipi.YipiTag(tag=tag, post_id=post.id, user_id=user.id))
    yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.posts_count, 1)
    return post


def publish_pending(announcements=None):
    """Posts what was not posted yet; returns how many posts were made."""
    made = 0
    for key, kind, text in (ANNOUNCEMENTS if announcements is None else announcements):
        if yipi.db.session.get(yipi.YipiAnnouncement, key) is not None:
            continue
        if len(text) > yipi.MAX_POST:
            log.error("announcement %s is too long", key)
            continue
        user = official(kind)
        post = post_as(user, text)
        yipi.db.session.add(yipi.YipiAnnouncement(id=key, post_id=post.id))
        try:
            yipi.db.session.commit()
            made += 1
        except IntegrityError:                       # another process was faster
            yipi.db.session.rollback()
    return made


def purge_levels():
    """The jump-and-run levels of the old builder are removed (the builder is gone)."""
    removed = yipi.PulseGame.query.filter_by(kind="platformer").delete()
    yipi.db.session.commit()
    return removed


def start_up(app):
    with app.app_context():
        official_ids()
        purge_levels()
        publish_pending()
        import yipi_captions
        yipi_captions.purge_orphans()


def _work(app):
    try:
        start_up(app)
    except Exception:  # noqa: BLE001
        log.exception("the official accounts could not be set up")
        try:
            with app.app_context():
                yipi.db.session.rollback()
        except Exception:  # noqa: BLE001
            pass


def attach(app):
    """The first request to the API after a start makes the accounts and posts the new announcements (in a thread, never in the request)."""
    def wake():
        if _state["started"] or not request.path.startswith("/api/yipi/"):
            return
        if app.config.get("TESTING") and not app.config.get("YIPI_COMPANY_IN_TESTS"):
            return
        with _lock:
            if _state["started"]:
                return
            _state["started"] = True
        threading.Thread(target=_work, args=(app,), name="nex-company", daemon=True).start()

    app.before_request(wake)
