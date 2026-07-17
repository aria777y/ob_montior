from ob_monitoring.settings import Settings


def test_settings_parse_four_regions(monkeypatch):
    monkeypatch.setenv("OB_DATABASE_URL", "postgresql+psycopg://ob:ob@db/ob")
    monkeypatch.setenv("OB_REGIONS", "ID,MY,TH,VN")
    settings = Settings()
    assert settings.regions == ("ID", "MY", "TH", "VN")
    assert settings.report_timezone == "Asia/Shanghai"
    assert settings.report_hour == 10
