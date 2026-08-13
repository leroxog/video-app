"""Seeds the Offer table with REAL businesses and real (web-researched)
prices -- replaces seed_offers.py's generic placeholder data. Every entry
below is sourced from the operator's own official site via a live web
search (see the source URL on each entry's link_url); several theme-park
and zoo prices are dynamic/seasonal, so treat these as representative,
not a live-updated feed (see Offer's own docstring on why prices are
entered by hand, never scraped automatically).

Run with: .venv/Scripts/python.exe seed_real_offers.py
"""
from app import app
from models import db, User, Offer

# (company_username, company_name, company_address) -- only Mathäser has
# an actual company account (created earlier via the real UI flow); every
# other entry below is admin-seeded (company_id=None), matching how
# Offer's own docstring describes example/reference listings.
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


def cents(euro):
    return round(euro * 100)


with app.app_context():
    mathaeser_user = User.query.filter_by(username=MATHAESER["username"]).first()
    if not mathaeser_user:
        mathaeser_user = User(
            username=MATHAESER["username"], is_company=True,
            company_name=MATHAESER["company_name"], company_address=MATHAESER["company_address"],
        )
        mathaeser_user.set_password(MATHAESER["password"])
        db.session.add(mathaeser_user)
        db.session.commit()
        print("Created Mathäser company account.")

    mathaeser_added = 0
    for data in MATHAESER_OFFERS:
        if Offer.query.filter_by(company_id=mathaeser_user.id, title=data["title"]).first():
            continue
        db.session.add(Offer(company_id=mathaeser_user.id, **data))
        mathaeser_added += 1
    db.session.commit()
    print(f"Added {mathaeser_added} Mathäser offers.")

    added = 0
    for provider, title, category, city, link, normal, discount, max_age, label in REAL_OFFERS:
        exists = Offer.query.filter_by(provider_name=provider, title=title, city=city).first()
        if exists:
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=city,
            link_url=link, normal_price_cents=cents(normal), discount_price_cents=cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
        added += 1
    db.session.commit()
    print(f"Added {added} real researched offers.")
    print(f"Total offers now: {Offer.query.count()}")
