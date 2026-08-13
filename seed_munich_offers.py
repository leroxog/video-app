"""Adds a big batch of REAL München offers on top of what seed_real_offers.py
already created -- restaurants/food (Essen, the "Uber Eats"-style
category the user asked for) plus a few more leisure venues, all
web-researched with real prices and real links. Existing offers from
other cities are left alone; this only adds to München.

Run with: .venv/Scripts/python.exe seed_munich_offers.py
"""
from app import app
from models import db, Offer

# provider_name, title, category, link_url, normal€, discount€ or None, max_age or None, label or None
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

MUNICH = "München"


def cents(euro):
    return round(euro * 100) if euro is not None else None


with app.app_context():
    added = 0
    for provider, title, category, link, normal, discount, max_age, label in MUNICH_OFFERS:
        if Offer.query.filter_by(provider_name=provider, title=title, city=MUNICH).first():
            continue
        db.session.add(Offer(
            company_id=None, provider_name=provider, title=title, category=category, city=MUNICH,
            link_url=link, normal_price_cents=cents(normal), discount_price_cents=cents(discount),
            discount_max_age=max_age, discount_label=label,
            description=f"Recherchierter Realpreis, Quelle: {link}",
        ))
        added += 1
    db.session.commit()
    print(f"Added {added} new München offers.")
    print(f"Total München offers now: {Offer.query.filter_by(city=MUNICH).count()}")
    print(f"Total offers overall: {Offer.query.count()}")
