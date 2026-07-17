from typing import Annotated, Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OB_", env_file=".env")

    database_url: str
    regions: Annotated[tuple[str, ...], NoDecode] = ("ID", "MY", "TH", "VN")
    report_timezone: str = "Asia/Shanghai"
    report_hour: int = 10
    seatalk_webhook_url: str | None = None
    callback_signing_secret: str = "local-only-change-me"

    @field_validator("regions", mode="before")
    @classmethod
    def parse_regions(cls, value: Any) -> Any:
        if isinstance(value, str):
            return tuple(item.strip().upper() for item in value.split(",") if item.strip())
        return value
