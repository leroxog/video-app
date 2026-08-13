"""Single source of truth for Cheaper's curated, real (web-researched) offers.

seed_offers() is idempotent (every insert is guarded by an existence check)
and is called automatically from app.py's startup block, so every deploy --
i.e. every `git push` to master, which Railway rebuilds and restarts --
re-applies this same data to the production database. That's what keeps the
live web app and the desktop app (a thin wrapper around that same live site,
see cheaper-desktop/src/main.js) in sync with whatever offers exist here,
without a separate manual seeding step per deploy.

Can still be run standalone for local dev: .venv/Scripts/python.exe seed_data.py
"""
from models import db, User, Offer

# Only Mathäser has an actual company account (created via the real UI
# flow); every other entry below is admin-seeded (company_id=None), matching
# how Offer's own docstring describes example/reference listings.
MATHAESER = {
    "username": "mathaeser_kino", "password": "secret123",
    "company_name": "Mathäser Filmpalast", "company_address": "Bayerstraße 3, 80335 München",
}

MATHAESER_OFFERS = [
    dict(provider_name="Mathäser Filmpalast", title="Komfort-Sessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=899, discount_price_cents=649,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem Komfort-Sessel im Mathäser Filmpalast München."),
    dict(provider_name="Mathäser Filmpalast", title="Premium-Sessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=1349, discount_price_cents=999,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem Premium-Sessel im Mathäser Filmpalast München."),
    dict(provider_name="Mathäser Filmpalast", title="D-Box-Bewegungssessel", category="unterhaltung", city="München",
         link_url="https://www.mathaeser.de/", normal_price_cents=1499, discount_price_cents=1149,
         discount_max_age=14, discount_label="Kinder bis 14 Jahre",
         description="Kinoticket auf einem D-Box-Bewegungssessel im Mathäser Filmpalast München."),
]

# provider_name, title, category, city, link_url, normal€, discount€ or None, max_age or None, label
REAL_OFFERS = [
    ("Deutsches Museum", "Tageskarte", "bildung", "München",
     "https://www.deutsches-museum.de/museumsinsel/besuch/preise-und-tickets",
     14.00, 8.00, 17, "Kinder & Jugendliche 6-17 Jahre"),
    ("Tierpark Hellabrunn", "Tageskarte", "bildung", "München",
     "https://www.hellabrunn.de/parkbesuch/allgemeine-informationen/tickets",
     20.00, 8.00, 14, "Kinder"),
    ("Zoo Berlin", "Tageskarte", "bildung", "Berlin",
     "https://www.zoo-berlin.de/de/tickets-service/tickets-preise",
     25.00, 12.50, 15, "Kinder"),
    ("Berliner Bäder-Betriebe", "Standardtarif Schwimmbad", "sport", "Berlin",
     "https://www.berlinerbaeder.de/preise-tarifsatzung/",
     5.50, 3.50, 17, "ermäßigt (u.a. Kinder/Jugendliche)"),
    ("Holthusenbad", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/alle-baeder/holthusenbad/",
     13.80, 9.70, 16, "Jugendliche 12-16 Jahre"),
    ("Parkbad Volksdorf", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/standorte/parkbad/",
     11.30, 5.50, 16, "Jugendliche 12-16 Jahre"),
    ("Festland", "Tageskarte", "sport", "Hamburg",
     "https://www.baederland.de/baeder/alle-baeder/festland/",
     11.70, 5.70, 16, "Jugendliche 12-16 Jahre"),
    ("Miniatur Wunderland", "Eintritt", "unterhaltung", "Hamburg",
     "https://www.miniatur-wunderland.com/visiting/plan-your-visit/admission-fees",
     22.00, 13.00, 15, "Kinder bis 15 Jahre"),
    ("Planetarium Hamburg", "Vorstellung", "bildung", "Hamburg",
     "https://www.planetarium-hamburg.de/de/besucherinformation",
     12.30, 7.70, 17, "ermäßigt (Schüler/Studierende)"),
    ("Kölner Zoo", "Tageskarte", "bildung", "Köln",
     "https://koelnerzoo.de/article/eintrittspreise/",
     27.00, 13.00, 12, "Kinder 4-12 Jahre (dynamische Preise, ca.)"),
    ("Zoo Frankfurt", "Tageskarte", "bildung", "Frankfurt",
     "https://www.zoo-frankfurt.de/de/zoobesuch-planen/eintrittskarten",
     12.00, 6.00, 17, "Kinder & Jugendliche 6-17 Jahre"),
    ("Wilhelma", "Tageskarte", "bildung", "Stuttgart",
     "https://www.wilhelma.de/en/visiting-us/information/entrance-fees",
     23.00, 9.00, 17, "Kinder ab 6 Jahren"),
    ("Zoo Leipzig", "Tageskarte", "bildung", "Leipzig",
     "https://www.zoo-leipzig.de/en/your-visit/prices-tickets/",
     26.00, 17.00, 16, "Kinder"),
    ("Zoo Dresden", "Tageskarte", "bildung", "Dresden",
     "https://www.zoo-dresden.de/besuch-planen/preise/",
     19.00, 10.00, 16, "Kinder"),
    ("LEGOLAND Deutschland", "Tageskarte", "freizeit", "Günzburg",
     "https://www.legoland.de/tickets/",
     64.00, 58.00, 11, "Kinder 2-11 Jahre (saisonale Preise, ca.)"),
    ("Phantasialand", "Tageskarte", "freizeit", "Brühl",
     "https://www.phantasialand.de/",
     66.00, 55.00, 11, "Kinder 4-11 Jahre (saisonale Preise, ca.)"),
    ("Europa-Park", "Tageskarte", "freizeit", "Rust",
     "https://www.europapark.de/en/theme-park/tickets-offers",
     72.00, 61.00, 11, "Kinder 4-11 Jahre (saisonale Preise, ca.)"),
    ("Movie Park Germany", "Tageskarte", "freizeit", "Bottrop",
     "https://www.movieparkgermany.de/",
     59.90, 54.90, 11, "Kinder 4-11 Jahre"),
]

# provider_name, title, category, link_url, normal€, discount€ or None, max_age or None, label or None
# -- all München, kept separate because every one of these is city-fixed.
MUNICH_OFFERS = [
    ("Pizziamo München", "Pizza Salami", "essen",
     "https://pizziamo089-bestellen.de/delivery", 13.00, None, None, None),
    ("Pizzeria Grano", "Pizza Margherita", "essen",
     "https://www.speisekarte.de/m%C3%BCnchen/restaurants/pizzeria", 6.90, None, None, None),
    ("L'Osteria München", "Pizza (Ø 40cm, zum Teilen)", "essen",
     "https://losteria.net/de/restaurants/restaurant/muenchen-kuenstlerhaus/", 11.90, None, None, None),
    ("Vapiano München", "Pasta", "essen",
     "https://all-menuprices.info/vapiano-speisekarte-preise/", 10.90, None, None, None),
    ("Hofbräuhaus München", "Hendl Bowl", "essen",
     "https://www.hofbraeuhaus.de/speisekarten/", 20.90, None, None, None),
    ("Hans Kebap", "Döner \"From Istanbul to Tokyo\"", "essen",
     "https://www.hanskebab.de/", 35.00, None, None, None),
    ("atoll München", "Bowling (1 Bahn/Stunde)", "freizeit",
     "https://atoll-muenchen.de/bowling-preise/", 19.00, None, None, None),
    ("Eis- und Funsportzentrum Ost", "Eintritt Eislaufen", "sport",
     "https://www.muenchen.de/freizeit/eislaufstadien/eis-und-funsportzentrum-ost",
     3.00, 2.00, 18, "Jugendliche bis 18 Jahre"),
]


def _cents(euro):
    return round(euro * 100) if euro is not None else None


def seed_offers():
    """Idempotently inserts every offer above that isn't already present.
    Safe to call on every app startup -- each insert is guarded by its own
    existence check, so re-running never creates duplicates.
    """
    mathaeser_user = User.query.filter_by(username=MATHAESER["username"]).first()
    if not mathaeser_user:
        mathaeser_user = User(
            username=MATHAESER["username"], is_company=True,
            company_name=MATHAESER["company_name"], company_address=MATHAESER["company_address"],
        )
        mathaeser_user.set_password(MATHAESER["password"])
        db.session.add(mathaeser_user)
        db.session.commit()

    for data in MATHAESER_OFFERS:
        if Offer.query.filter_by(company_id=mathaeser_user.id, title=data["title"]).first():
            continue
        db.session.add(Offer(company_id=mathaeser_user.id, **data))
    db.session.commit()

    for provider, title, category, city, link, normal, discount, max_age, label in REAL_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=city).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=city,
            link_url=link, normal_price_cents=_cents(normal), discount_price_cents=_cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
    db.session.commit()

    munich = "München"
    for provider, title, category, link, normal, discount, max_age, label in MUNICH_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=munich).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=munich,
            link_url=link, normal_price_cents=_cents(normal), discount_price_cents=_cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
    db.session.commit()


if __name__ == "__main__":
    from app import app
    with app.app_context():
        before = Offer.query.count()
        seed_offers()
        after = Offer.query.count()
        print(f"Offers: {before} -> {after}")
