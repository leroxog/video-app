"""Satürn, 2026-11-02: Nex can use free services (yipi_nex_tools.py): the weather, Wikipedia, rates, calculations, jokes, dice and more. The services are made up here (requests.get is replaced): the tests
check which question wakes which service, that a service that is down is skipped, that at most two answer, that nothing leaves the fixed hosts, and how the answers reach Nex."""
import os
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import ai_assistant  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_nex_tools as tools  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


class Reply:
    def __init__(self, data=None, status=200, text=""):
        self.data, self.status_code, self.text = data, status, text

    def json(self):
        return self.data


@pytest.fixture
def services(monkeypatch):
    """The free services, made up: every request is written down and answered by the table."""
    calls = []
    answers = {
        "geocoding-api.open-meteo.com": {"results": [{"name": "Berlin", "country": "Deutschland", "latitude": 52.5, "longitude": 13.4}]},
        "api.open-meteo.com": {"current": {"temperature_2m": 8.3, "apparent_temperature": 6.0, "weather_code": 3, "wind_speed_10m": 4.2, "relative_humidity_2m": 67},
                               "daily": {"temperature_2m_max": [9.7, 11], "temperature_2m_min": [5.9, 6], "precipitation_probability_max": [3, 10], "sunrise": ["2026-11-02T07:05"], "sunset": ["2026-11-02T16:40"]}},
        "de.wikipedia.org/w/api.php": ["Albert", ["Albert Einstein"], [""], [""]],
        "de.wikipedia.org/api/rest_v1": {"title": "Albert Einstein", "extract": "Albert Einstein war ein theoretischer Physiker."},
        "api.frankfurter.app": {"rates": {"USD": 56.08}, "date": "2026-11-02"},
        "api.coingecko.com": {"bitcoin": {"eur": 69110, "usd": 77427, "eur_24h_change": -0.9}},
        "v2.jokeapi.dev": {"type": "twopart", "setup": "Was sagt ein Hai?", "delivery": "Nichts, er ist stumm."},
        "api.agify.io": {"age": 46, "count": 2299},
    }

    def fake(url, params=None, headers=None, timeout=None, **kwargs):
        calls.append((url, params))
        if "api.mathjs.org" in url:
            return Reply(text="84")
        for host, data in answers.items():
            if host in url:
                return Reply(data)
        raise tools.requests.ConnectionError("not made up: " + url)
    monkeypatch.setattr(tools.requests, "get", fake)
    fake.calls = calls
    fake.answers = answers
    return fake


def test_a_question_about_the_weather_wakes_the_weather_and_the_answer_has_the_facts(services):
    out = tools.run("Wie ist das Wetter in Berlin?")
    assert "Wetter in Berlin (Deutschland): jetzt 8.3 °C" in out and "Sonnenuntergang 16:40" in out and out.startswith("Daten aus kostenlosen Diensten")
    assert {url.split("/")[2] for url, _ in services.calls} == {"geocoding-api.open-meteo.com", "api.open-meteo.com"}, "only the fixed hosts are asked"


def test_who_is_wakes_wikipedia_and_a_sum_wakes_the_calculator_but_a_number_is_no_topic(services):
    assert "Wikipedia „Albert Einstein“: Albert Einstein war ein theoretischer Physiker." in tools.run("Wer ist Albert Einstein?")
    out = tools.run("Was ist 12 * (3 + 4)")
    assert "Rechnung (math.js): 12 * (3 + 4) = 84" in out and "Wikipedia" not in out
    assert tools.run("Erzähl mir etwas über Albert Einstein") != ""


def test_rates_prices_and_jokes_and_names(services):
    assert "50.0 EUR = 56.08 USD" in tools.run("Wie viel sind 50 Euro in Dollar?")
    assert tools.run("Wie viel sind 50 Euro in Euro?") == "", "the same currency is no question"
    assert "69110 € / 77427 $" in tools.run("Was kostet ein Bitcoin gerade?")
    assert "Was sagt ein Hai? – Nichts, er ist stumm." in tools.run("Erzähl mir einen Witz")
    assert "etwa 46 Jahre alt" in tools.run("Wie alt ist der Name Lorenz?")


def test_what_needs_no_service_works_without_one(monkeypatch):
    def never(*args, **kwargs):
        raise AssertionError("no service should be asked")
    monkeypatch.setattr(tools.requests, "get", never)
    assert tools.run("Würfel mal").startswith("Daten aus kostenlosen Diensten") and "Würfel (W6)" in tools.run("Wirf einen Würfel")
    assert "Würfel (W20)" in tools.run("Wirf einen W20") and 1 <= int(tools.run("W20").split(": ")[-1]) <= 20
    assert "Münzwurf" in tools.run("Wirf eine Münze") and "Magische Kugel" in tools.run("Frag die magische Kugel")


def test_a_service_that_is_down_is_skipped_and_a_question_that_fits_nothing_gives_nothing(services, monkeypatch):
    monkeypatch.setattr(tools.requests, "get", lambda *args, **kwargs: (_ for _ in ()).throw(tools.requests.Timeout("slow")))
    assert tools.run("Wie ist das Wetter in Berlin?") == ""
    monkeypatch.setattr(tools.requests, "get", lambda *args, **kwargs: Reply(None, 500))
    assert tools.run("Erzähl mir einen Witz") == ""
    assert tools.run("Schreib mir ein Gedicht über den Herbst") == "" and tools.run("") == "" and tools.run(None) == ""


def test_at_most_two_services_answer_one_question(services):
    out = tools.run("Wie ist das Wetter in Berlin, was kostet Bitcoin, erzähl einen Witz und wirf einen Würfel?")
    assert out.count("\n- ") == tools.MAX_TOOLS == 2


def test_the_calculator_only_gets_numbers_and_signs(services):
    assert tools.run("Berechne 2 + 2; rm -rf /") == "" or "rm -rf" not in " ".join(url for url, _ in services.calls)
    for url, params in services.calls:
        assert "rm" not in str(params)


def test_the_free_ai_of_pollinations_is_a_second_chance(monkeypatch):
    seen = {}

    def post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json)
        return Reply({"choices": [{"message": {"content": "  Hallo vom zweiten Modell  "}}]})
    monkeypatch.setattr(tools.requests, "post", post)
    assert tools.fallback_text("Du bist Nex", "Nutzer: Hallo", 300) == "Hallo vom zweiten Modell"
    assert seen["url"] == "https://text.pollinations.ai/openai" and seen["body"]["messages"][1]["content"] == "Nutzer: Hallo" and seen["body"]["max_tokens"] == 300
    monkeypatch.setattr(tools.requests, "post", lambda *a, **k: Reply(None, 503))
    assert tools.fallback_text("a", "b") is None
    monkeypatch.setattr(tools.requests, "post", lambda *a, **k: (_ for _ in ()).throw(tools.requests.ConnectionError("down")))
    assert tools.fallback_text("a", "b") is None


# ================================================================================================ the chat of Nex
@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def person(client, handle="mia"):
    assert client.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return client


def test_the_answers_of_the_services_go_to_nex_with_the_question_and_the_tests_never_ask_the_internet_by_themselves(client, monkeypatch):
    seen = []

    def fake(system_prompt, message, max_tokens=600, temperature=0.7, **kwargs):
        seen.append(message)
        yield "Antwort"
    monkeypatch.setattr(ai_assistant, "generate_custom_stream", fake)
    asked = []
    monkeypatch.setattr(tools, "run", lambda question: asked.append(question) or "Daten aus kostenlosen Diensten:\n- Wetter in Berlin: 8 °C")
    mia = person(client)
    mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Wetter in Berlin?"}]})
    assert asked == [] and "Daten aus kostenlosen Diensten" not in seen[0], "under pytest the services are not asked"
    monkeypatch.setenv("NEX_TOOLS_IN_TESTS", "1")
    reply = mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Wetter in Berlin?"}]})
    assert reply.get_data(as_text=True) == "Antwort" and asked == ["Wetter in Berlin?"]
    assert seen[1].startswith("Daten aus kostenlosen Diensten:\n- Wetter in Berlin: 8 °C") and "Nutzer: Wetter in Berlin?" in seen[1]


def test_when_the_main_ai_says_nothing_the_free_one_answers(client, monkeypatch):
    def silent(system_prompt, message, max_tokens=600, temperature=0.7, **kwargs):
        raise RuntimeError("Groq ist down")
        yield  # pragma: no cover
    monkeypatch.setattr(ai_assistant, "generate_custom_stream", silent)
    monkeypatch.setattr(tools, "run", lambda question: "")
    monkeypatch.setattr(tools, "fallback_text", lambda system, transcript, tokens: "Die Antwort der zweiten KI")
    monkeypatch.setenv("NEX_TOOLS_IN_TESTS", "1")
    mia = person(client)
    reply = mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Hallo"}]})
    assert reply.get_data(as_text=True) == "Die Antwort der zweiten KI"


def test_the_site_announces_what_nex_can_do_now():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-02-nextools" in lines and lines["2026-11-02-nextools"][1] == "ai" and len(lines["2026-11-02-nextools"][2]) <= 280 and lines["2026-11-02-nextools"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)
