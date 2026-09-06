from collections.abc import Iterator
from datetime import datetime

import pytest

from src.parsers import fit_parser


class _Field:
    def __init__(self, value: object) -> None:
        self.value = value


class _RecordMessage:
    name = "record"

    def __init__(self, values: dict[str, object]) -> None:
        self.values = values

    def get_field(self, name: str) -> _Field:
        if name not in self.values:
            raise KeyError(name)
        return _Field(self.values[name])


class _Reader:
    def __init__(self, record: _RecordMessage) -> None:
        self.record = record

    def __enter__(self) -> "_Reader":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def __iter__(self) -> Iterator[_RecordMessage]:
        return iter([self.record])


def test_parse_fit_file_keeps_native_effort_pace(monkeypatch: pytest.MonkeyPatch) -> None:
    record = _RecordMessage(
        {
            "timestamp": datetime(2026, 9, 6, 0, 0),
            "speed": 2.0,
            "Effort Pace": 2.5,
        }
    )
    monkeypatch.setattr(fit_parser.fitdecode, "FitDataMessage", _RecordMessage)
    monkeypatch.setattr(fit_parser.fitdecode, "FitReader", lambda _: _Reader(record))

    parsed = fit_parser.parse_fit_file(b"FIT")

    assert parsed.records[0].speed_mps == 2.0
    assert parsed.records[0].effort_speed_mps == 2.5
