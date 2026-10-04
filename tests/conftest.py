def pytest_configure(config):
    config.addinivalue_line("markers", "real_hashing: use the real (slow) password hashing instead of the quick stand-in")
